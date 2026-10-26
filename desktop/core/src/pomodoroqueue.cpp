#include "pomodoroqueue.h"

#include <algorithm>

namespace Tokkl
{

namespace
{
// The wait before attempt number attempts: 5 s, doubling up to 5 min.
qint64 retryDelayMs(int attempts)
{
    const int doublings = std::min(6, std::max(0, attempts - 1));
    return std::min<qint64>(300 * 1000, (5 * 1000) << doublings);
}

// The server refused the item for good. 401 is a credential problem, 408 and
// 429 are worth another try.
bool irrecoverable(const ApiError &error)
{
    return error.kind == ApiError::Kind::Forbidden || (error.kind == ApiError::Kind::Client && error.status != 408);
}

// An entry on the server that is the item: same start and same stop.
bool hasSaved(const QList<TimeEntry> &entries, const UnsavedPomodoro &item)
{
    return std::any_of(entries.cbegin(), entries.cend(), [&item](const TimeEntry &entry) {
        return entry.start == item.start && entry.stop && *entry.stop == item.stop;
    });
}

StoppedEntry stoppedEntry(const UnsavedPomodoro &item)
{
    StoppedEntry entry;
    entry.start = item.start;
    entry.stop = item.stop;
    entry.duration = item.duration;
    entry.projectId = item.projectId;
    entry.billable = item.billable;
    return entry;
}

// The stored item with the given id, or the end of the list.
QList<UnsavedPomodoro>::iterator find(PomodoroRecord &record, const QString &id)
{
    return std::find_if(record.unsaved.begin(), record.unsaved.end(), [&id](const UnsavedPomodoro &item) {
        return item.id == id;
    });
}
}

PomodoroQueue::PomodoroQueue(Connection *connection, Clock *clock, PomodoroStore *store, QObject *parent)
    : QObject(parent)
    , m_connection(connection)
    , m_clock(clock)
    , m_store(store)
{
    if (m_connection) {
        connect(m_connection, &Connection::stateChanged, this, &PomodoroQueue::onConnectionChanged);
        // The account can change while the state stays Connected.
        connect(m_connection, &Connection::accountChanged, this, &PomodoroQueue::onConnectionChanged);
        connect(m_connection, &Connection::generationChanged, this, &PomodoroQueue::onGenerationChanged);
    }
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &PomodoroQueue::onTick);
    }
    onConnectionChanged();
}

QString PomodoroQueue::message() const
{
    return m_message;
}

void PomodoroQueue::clearMessage()
{
    setMessage(QString());
}

bool PomodoroQueue::enqueue(const UnsavedPomodoro &item, const std::optional<PomodoroSessionRecord> &session)
{
    if (item.owner.isEmpty() || item.workspaceId <= 0 || !m_store) {
        return false;
    }
    PomodoroRecord record = load(item.owner);
    record.session = session;
    if (find(record, item.id) == record.unsaved.end()) {
        record.unsaved.append(item);
    }
    if (!save(item.owner, record)) {
        return false;
    }
    if (item.owner == owner()) {
        readNextDue();
        run(false);
    }
    return true;
}

void PomodoroQueue::flushForSignOut()
{
    const QString owner = this->owner();
    if (owner.isEmpty() || !m_store) {
        return;
    }
    // The run in progress stops after the request in flight; its reply finds
    // nothing left to remove.
    m_planned.clear();
    m_runAgain = false;
    m_runAgainForced = false;

    PomodoroRecord record = load(owner);
    const QDateTime now = m_clock ? m_clock->now() : QDateTime::currentDateTimeUtc();
    QList<UnsavedPomodoro> untried;
    for (UnsavedPomodoro &item : record.unsaved) {
        if (item.owner == owner && item.attempts == 0) {
            item.attempts = 1;
            item.retryAt = now.addMSecs(retryDelayMs(1));
            untried.append(item);
        }
    }
    // The attempts are written before the POSTs, as always; then the items
    // are gone whatever the replies say.
    if (!untried.isEmpty() && save(owner, record) && m_connection) {
        for (const UnsavedPomodoro &item : std::as_const(untried)) {
            m_connection->createStoppedEntryDetached(stoppedEntry(item));
        }
    }
    record.unsaved.removeIf([&owner](const UnsavedPomodoro &item) {
        return item.owner == owner;
    });
    save(owner, record);
    readNextDue();
}

void PomodoroQueue::onConnectionChanged()
{
    const QString owner = this->owner();
    if (owner != m_owner) {
        m_owner = owner;
        readNextDue();
    }
    const bool online = m_connection && m_connection->state() == Connection::Connected && m_connection->isConnected();
    const bool cameOnline = online && !m_online;
    m_online = online;
    if (cameOnline) {
        run(true);
    }
}

void PomodoroQueue::onGenerationChanged()
{
    // A request in flight never answers now. The item it carried stays
    // stored with its attempt counted.
    m_running = false;
    m_planned.clear();
    m_runAgain = false;
    m_runAgainForced = false;
    m_online = false;
    onConnectionChanged();
}

void PomodoroQueue::onTick()
{
    if (m_running || !m_nextDue.isValid() || !m_clock || m_clock->now() < m_nextDue) {
        return;
    }
    run(false);
}

void PomodoroQueue::run(bool force)
{
    if (m_running) {
        m_runAgain = true;
        m_runAgainForced = m_runAgainForced || force;
        return;
    }
    if (!canPost()) {
        return;
    }
    const QString owner = this->owner();
    const QDateTime now = m_clock->now();
    m_planned.clear();
    for (const UnsavedPomodoro &item : load(owner).unsaved) {
        if (item.owner == owner && (force || item.retryAt <= now)) {
            m_planned.append({item.id, item.attempts});
        }
    }
    m_running = true;
    next();
}

void PomodoroQueue::next()
{
    while (!m_planned.isEmpty() && canPost()) {
        const Planned planned = m_planned.takeFirst();
        const QString owner = this->owner();
        PomodoroRecord record = load(owner);
        const auto it = find(record, planned.id);
        // Skipped when it was saved, dropped or tried meanwhile.
        if (it == record.unsaved.end() || it->attempts != planned.attempts || it->owner != owner) {
            continue;
        }
        attempt(*it);
        return;
    }
    m_planned.clear();
    m_running = false;
    readNextDue();
    if (m_runAgain) {
        m_runAgain = false;
        const bool force = m_runAgainForced;
        m_runAgainForced = false;
        run(force);
    }
}

void PomodoroQueue::attempt(const UnsavedPomodoro &item)
{
    // The attempt is on record before anything is sent, so a crash before
    // the reply is followed by a lookup, not a blind POST.
    UnsavedPomodoro attempted = item;
    attempted.attempts = item.attempts + 1;
    attempted.retryAt = m_clock->now().addMSecs(retryDelayMs(attempted.attempts));
    PomodoroRecord record = load(item.owner);
    const auto it = find(record, item.id);
    if (it == record.unsaved.end()) {
        next();
        return;
    }
    *it = attempted;
    if (!save(item.owner, record)) {
        next();
        return;
    }
    if (item.attempts == 0) {
        post(attempted);
        return;
    }
    // An earlier attempt may have reached the server. A failed lookup says
    // nothing about that, so the item waits for its next try.
    QPointer<PomodoroQueue> self(this);
    m_connection->fetchEntriesBetween(attempted.start, attempted.stop, [self, attempted](const ApiResult<QList<TimeEntry>> &result) {
        if (!self) {
            return;
        }
        if (result.ok() && hasSaved(*result.value, attempted)) {
            self->remove(attempted);
        } else if (result.ok()) {
            self->post(attempted);
            return;
        }
        self->next();
    });
}

void PomodoroQueue::post(const UnsavedPomodoro &item)
{
    // Detached, so a sign-out right after an ended pomodoro does not abort
    // the request before it leaves. The reply, if dropped with the account,
    // leaves the item on record for a lookup.
    QPointer<PomodoroQueue> self(this);
    m_connection->createStoppedEntryDetached(stoppedEntry(item), [self, item](const ApiResult<TimeEntry> &result) {
        if (self) {
            self->finishPost(item, result);
        }
    });
}

void PomodoroQueue::finishPost(const UnsavedPomodoro &item, const ApiResult<TimeEntry> &result)
{
    if (result.ok()) {
        remove(item);
    } else if (irrecoverable(result.error)) {
        remove(item);
        setMessage(result.error.message);
    }
    next();
}

void PomodoroQueue::remove(const UnsavedPomodoro &item)
{
    PomodoroRecord record = load(item.owner);
    if (record.unsaved.removeIf([&item](const UnsavedPomodoro &stored) {
            return stored.id == item.id;
        })) {
        save(item.owner, record);
    }
}

void PomodoroQueue::readNextDue()
{
    m_nextDue = QDateTime();
    const QString owner = this->owner();
    if (owner.isEmpty() || !m_store) {
        return;
    }
    for (const UnsavedPomodoro &item : load(owner).unsaved) {
        if (item.owner == owner && (!m_nextDue.isValid() || item.retryAt < m_nextDue)) {
            m_nextDue = item.retryAt;
        }
    }
}

bool PomodoroQueue::canPost() const
{
    return m_connection && m_clock && m_store && m_connection->canWrite() && !owner().isEmpty();
}

QString PomodoroQueue::owner() const
{
    return m_connection ? m_connection->owner() : QString();
}

PomodoroRecord PomodoroQueue::load(const QString &owner) const
{
    return m_store ? PomodoroRecord::fromJson(m_store->loadRecord(owner)) : PomodoroRecord();
}

bool PomodoroQueue::save(const QString &owner, const PomodoroRecord &record)
{
    return m_store && m_store->saveRecord(owner, record.toJson());
}

void PomodoroQueue::setMessage(const QString &message)
{
    if (message == m_message) {
        return;
    }
    m_message = message;
    Q_EMIT messageChanged();
}

}
