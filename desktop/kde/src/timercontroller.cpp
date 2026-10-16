#include "timercontroller.h"

#include <algorithm>

namespace Tokkl
{

TimerController::TimerController(QObject *parent)
    : TimerController(nullptr, parent)
{
    m_clock = new SystemClock(this);
    connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
}

TimerController::TimerController(Clock *clock, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
{
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
    }
}

TimerController::~TimerController() = default;

Connection *TimerController::connection() const
{
    return m_connection;
}

void TimerController::setConnection(Connection *connection)
{
    if (connection == m_connection) {
        return;
    }
    if (m_connection) {
        disconnect(m_connection, nullptr, this, nullptr);
    }
    m_connection = connection;
    if (m_connection) {
        connect(m_connection, &Connection::generationChanged, this, &TimerController::reset);
        connect(m_connection, &Connection::stateChanged, this, &TimerController::onConnectionChanged);
        connect(m_connection, &Connection::accountChanged, this, &TimerController::onConnectionChanged);
        connect(m_connection, &Connection::nextStartChanged, this, &TimerController::selectionChanged);
        connect(m_connection, &QObject::destroyed, this, &TimerController::reset);
    }
    reset();
    Q_EMIT connectionChanged();
    Q_EMIT selectionChanged();
    onConnectionChanged();
}

bool TimerController::isConnected() const
{
    return m_connection && m_connection->isConnected();
}

QVariantMap TimerController::account() const
{
    return m_connection ? m_connection->accountMap() : QVariantMap();
}

qint64 TimerController::workspaceId() const
{
    return m_connection ? m_connection->workspaceId() : 0;
}

Connection::State TimerController::connectionState() const
{
    return m_connection ? m_connection->state() : Connection::Unconfigured;
}

bool TimerController::isStale() const
{
    return m_entryStale || (m_connection && m_connection->isStale());
}

bool TimerController::workspaceAccessLost() const
{
    return m_workspaceLost;
}

bool TimerController::isBusy() const
{
    return m_mutating || m_reconciling;
}

bool TimerController::canWrite() const
{
    return m_connection && m_connection->canWrite() && m_clock && !m_workspaceLost && m_entryKnown && !isBusy();
}

QString TimerController::errorString() const
{
    if (!m_error.isEmpty()) {
        return m_error;
    }
    if (m_connection && m_connection->state() != Connection::Connected) {
        return m_connection->errorString();
    }
    return QString();
}

std::optional<TimeEntry> TimerController::currentEntry() const
{
    return m_entry;
}

QVariant TimerController::currentEntryVariant() const
{
    return m_entry ? QVariant(m_entry->toVariantMap()) : QVariant::fromValue(nullptr);
}

bool TimerController::isRunning() const
{
    return m_entry.has_value();
}

qint64 TimerController::elapsedSeconds() const
{
    return m_elapsed;
}

QString TimerController::elapsedText() const
{
    return formatElapsed(m_elapsed);
}

QVariantList TimerController::projects() const
{
    QVariantList list;
    for (const Project &project : m_projects) {
        list.append(project.toVariantMap());
    }
    return list;
}

QVariant TimerController::selectedProjectId() const
{
    return m_connection ? m_connection->nextProjectIdVariant() : QVariant::fromValue(nullptr);
}

void TimerController::setSelectedProjectId(const QVariant &projectId)
{
    if (m_connection) {
        m_connection->setNextProjectIdVariant(projectId);
    }
}

bool TimerController::billable() const
{
    return m_connection && m_connection->nextBillable();
}

void TimerController::setBillable(bool billable)
{
    if (m_connection) {
        m_connection->setNextBillable(billable);
    }
}

QString TimerController::formatElapsed(qint64 seconds)
{
    seconds = std::max<qint64>(0, seconds);
    return QStringLiteral("%1:%2:%3")
        .arg(seconds / 3600)
        .arg((seconds % 3600) / 60, 2, 10, QLatin1Char('0'))
        .arg(seconds % 60, 2, 10, QLatin1Char('0'));
}

// ----- actions -------------------------------------------------------------

bool TimerController::start()
{
    if (!canWrite() || m_entry) {
        return false;
    }
    StartEntry entry;
    entry.start = m_clock->now().toUTC();
    entry.projectId = m_connection->nextProjectId();
    entry.billable = m_connection->nextBillable();
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->startEntry(entry, [self, epoch](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost) {
            self->applyEntry(result.value->isRunning() ? result.value : std::nullopt);
        }
        self->finishMutation(result.error, result.ok());
    });
    return true;
}

bool TimerController::stop()
{
    if (!canWrite() || !m_entry) {
        return false;
    }
    const qint64 entryId = m_entry->id;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->stopEntry(entryId, [self, epoch, entryId](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId) {
            self->applyEntry(std::nullopt);
        }
        self->finishMutation(result.error, result.ok());
    });
    return true;
}

bool TimerController::toggle()
{
    return m_entry ? stop() : start();
}

void TimerController::beginMutation()
{
    m_mutating = true;
    // Reads issued so far may describe the state before this mutation.
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    m_error.clear();
    Q_EMIT statusChanged();
}

void TimerController::finishMutation(const ApiError &error, bool succeeded)
{
    m_mutating = false;
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    if (m_workspaceLost) {
        Q_EMIT statusChanged();
        return;
    }
    if (succeeded) {
        setError(QString());
        fetchEntry();
        Q_EMIT statusChanged();
        return;
    }

    switch (error.kind) {
    case ApiError::Kind::Forbidden:
        loseWorkspace(error);
        return;
    case ApiError::Kind::RateLimited:
    case ApiError::Kind::NotConnected:
    case ApiError::Kind::AuthenticationPaused:
        // Refused before the server acted. Reconnection or the end of the
        // cooldown reads the entry again.
        setError(error.message);
        break;
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
    case ApiError::Kind::InvalidResponse:
        // The server may have acted. Stay busy until a read shows its state;
        // never send the mutation again.
        m_reconciling = true;
        setError(error.message);
        fetchEntry();
        break;
    default:
        // Answered and refused, for example a 409 for an entry that was
        // already stopped. Read what the server has now.
        setError(error.message);
        fetchEntry();
        break;
    }
    Q_EMIT statusChanged();
}

void TimerController::loseWorkspace(const ApiError &error)
{
    m_workspaceLost = true;
    m_entryKnown = false;
    m_entryStale = false;
    // A start or stop in flight keeps its lock until it answers, and the
    // server state stays unknown until a read after that answer.
    if (m_mutating) {
        m_reconciling = true;
    }
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    applyEntry(std::nullopt);
    if (!m_projects.isEmpty()) {
        m_projects.clear();
        Q_EMIT projectsChanged();
    }
    if (m_connection) {
        m_connection->setNextProjectId(std::nullopt);
        m_connection->setNextBillable(false);
        // The account may have another workspace now. Ask once; a different
        // default workspace starts a new generation, which lifts the block.
        if (!m_rediscoveryUsed) {
            m_rediscoveryUsed = true;
            m_connection->fetchMe();
        }
    }
    Q_EMIT statusChanged();
}

// ----- reads ---------------------------------------------------------------

void TimerController::refresh()
{
    fetchEntry();
    fetchProjects();
}

void TimerController::resumed()
{
    refresh();
}

void TimerController::reconnect()
{
    if (!m_connection) {
        return;
    }
    const bool wasLost = m_workspaceLost;
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_error.clear();
    Q_EMIT statusChanged();
    m_connection->reconnect();
    if (wasLost && isConnected()) {
        // The account stays bound through revalidation; no state change
        // would trigger the reload.
        refresh();
    }
}

bool TimerController::readable() const
{
    return m_connection && m_connection->isConnected() && !m_workspaceLost && !m_connection->rateLimitedUntil().isValid();
}

void TimerController::fetchEntry()
{
    if (!readable() || m_mutating || m_entryReadPending != 0) {
        return;
    }
    const quint64 number = ++m_readsIssued;
    m_entryReadPending = number;
    if (m_clock) {
        m_nextPoll = m_clock->now().addMSecs(pollIntervalMs);
    }

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->fetchCurrentEntry([self, epoch, number](const ApiResult<std::optional<TimeEntry>> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (self->m_entryReadPending == number) {
            self->m_entryReadPending = 0;
        }
        if (number < self->m_firstValidRead || number <= self->m_lastAppliedRead || self->m_workspaceLost) {
            return; // overtaken by a mutation or a newer read
        }
        if (!result.ok()) {
            // After a transient failure the entry shown stays stale until a
            // current-entry read succeeds, even if other requests recover the
            // connection first. Refused credentials start a new generation
            // and never reach this point.
            if (result.error.isTransient()) {
                self->m_entryStale = true;
            }
            if (!result.error.isTransient() && result.error.kind != ApiError::Kind::RateLimited) {
                self->setError(result.error.message);
            }
            Q_EMIT self->statusChanged();
            return;
        }
        self->m_lastAppliedRead = number;
        self->m_entryKnown = true;
        self->m_entryStale = false;
        self->m_reconciling = false;
        self->setError(QString());
        self->applyEntry(*result.value);
        Q_EMIT self->statusChanged();
    });
}

void TimerController::fetchProjects()
{
    if (!readable() || m_projectsPending) {
        return;
    }
    m_projectsPending = true;

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->fetchProjects([self, epoch](const ApiResult<QList<Project>> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        self->m_projectsPending = false;
        if (self->m_workspaceLost) {
            return;
        }
        if (result.ok()) {
            self->m_projects = *result.value;
            Q_EMIT self->projectsChanged();
        } else if (result.error.kind == ApiError::Kind::Forbidden) {
            self->loseWorkspace(result.error);
        } else {
            Q_EMIT self->statusChanged();
        }
    });
}

void TimerController::applyEntry(const std::optional<TimeEntry> &entry)
{
    std::optional<TimeEntry> next = entry;
    if (next && next->workspaceId != workspaceId()) {
        // Running in another workspace: not part of this context.
        next.reset();
    }
    const bool changed = next.has_value() != m_entry.has_value() || (next && next->toVariantMap() != m_entry->toVariantMap());
    m_entry = next;
    if (changed) {
        Q_EMIT currentEntryChanged();
    }
    updateElapsed();
}

// ----- clock and connection ------------------------------------------------

void TimerController::onTick()
{
    if (!m_clock) {
        return;
    }
    const QDateTime now = m_clock->now();
    const qint64 gap = m_lastTick.isValid() ? m_lastTick.msecsTo(now) : 0;
    m_lastTick = now;
    updateElapsed();
    if (gap > resumeGapMs || gap < -resumeGapMs) {
        resumed();
        return;
    }
    // A clock set back would otherwise postpone the poll.
    if (!m_nextPoll.isValid() || now >= m_nextPoll || now.msecsTo(m_nextPoll) > pollIntervalMs) {
        fetchEntry();
    }
}

void TimerController::onConnectionChanged()
{
    const Connection::State state = connectionState();
    if (isConnected()) {
        if (!m_loaded) {
            m_loaded = true;
            refresh();
        } else if (state == Connection::Connected && m_lastState != Connection::Connected) {
            // Back from a connectivity failure or a cooldown.
            refresh();
        }
    }
    m_lastState = state;
    Q_EMIT contextChanged();
    Q_EMIT statusChanged();
}

void TimerController::reset()
{
    // Another generation, account or connection: nothing carries over.
    ++m_epoch;
    m_mutating = false;
    m_reconciling = false;
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    m_entryKnown = false;
    m_entryStale = false;
    m_firstValidRead = m_readsIssued + 1;
    m_lastAppliedRead = m_readsIssued;
    m_entryReadPending = 0;
    m_projectsPending = false;
    m_nextPoll = QDateTime();
    m_error.clear();
    m_lastState = connectionState();
    if (m_entry) {
        m_entry.reset();
        Q_EMIT currentEntryChanged();
    }
    updateElapsed();
    if (!m_projects.isEmpty()) {
        m_projects.clear();
        Q_EMIT projectsChanged();
    }
    Q_EMIT contextChanged();
    Q_EMIT statusChanged();
}

void TimerController::setError(const QString &error)
{
    m_error = error;
}

void TimerController::updateElapsed()
{
    const qint64 elapsed = m_entry && m_clock ? std::max<qint64>(0, m_entry->start.secsTo(m_clock->now())) : 0;
    if (elapsed != m_elapsed) {
        m_elapsed = elapsed;
        Q_EMIT elapsedChanged();
    }
}

}
