#include "pomodorosession.h"

#include <QUuid>

#include <algorithm>

namespace Tokkl
{

namespace
{
// The kind of phase a transition starts.
QString nextPhaseName(TransitionKind transition)
{
    switch (transition) {
    case TransitionKind::WorkToShortRest:
        return phaseKindName(PhaseKind::ShortRest);
    case TransitionKind::WorkToLongRest:
        return phaseKindName(PhaseKind::LongRest);
    case TransitionKind::ShortRestToWork:
    case TransitionKind::LongRestToWork:
        return phaseKindName(PhaseKind::Work);
    }
    return QString();
}
}

PomodoroSession::PomodoroSession(Clock *clock, TimerController *timer, PomodoroPreferences *preferences, PomodoroQueue *queue, PomodoroStore *store, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
    , m_timer(timer)
    , m_preferences(preferences)
    , m_queue(queue)
    , m_store(store)
{
    if (m_store) {
        m_pomodoroMode = m_store->loadPomodoroMode();
    }
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &PomodoroSession::onTick);
    }
    if (m_timer) {
        connect(m_timer, &TimerController::connectionChanged, this, &PomodoroSession::onConnectionChanged);
        connect(m_timer, &TimerController::contextChanged, this, &PomodoroSession::onContextChanged);
        connect(m_timer, &TimerController::currentEntryChanged, this, &PomodoroSession::onEntryChanged);
        connect(m_timer, &TimerController::chainChanged, this, &PomodoroSession::update);
        connect(m_timer, &TimerController::choiceChanged, this, &PomodoroSession::onChoiceChanged);
    }
    if (m_preferences) {
        connect(m_preferences, &PomodoroPreferences::refreshed, this, &PomodoroSession::onRefreshed);
    }
    if (m_queue) {
        connect(m_queue, &PomodoroQueue::messageChanged, this, [this] {
            setMessage(m_queue->message());
        });
    }
    onConnectionChanged();
}

bool PomodoroSession::pomodoroMode() const
{
    return m_pomodoroMode;
}

bool PomodoroSession::setPomodoroMode(bool pomodoro)
{
    if (pomodoro == m_pomodoroMode) {
        return true;
    }
    if (m_modeLocked) {
        return false;
    }
    if (m_store && !m_store->savePomodoroMode(pomodoro)) {
        return false;
    }
    m_pomodoroMode = pomodoro;
    Q_EMIT modeChanged();
    update();
    return true;
}

bool PomodoroSession::modeLocked() const
{
    return m_modeLocked;
}

bool PomodoroSession::isActive() const
{
    return m_session.has_value();
}

QString PomodoroSession::phase() const
{
    return m_session ? phaseKindName(m_session->phase.kind) : QString();
}

QDateTime PomodoroSession::phaseStart() const
{
    return m_session ? m_session->phase.startedAt : QDateTime();
}

QDateTime PomodoroSession::plannedEnd() const
{
    if (!m_session) {
        return QDateTime();
    }
    return Tokkl::plannedEnd(m_session->phase, m_session->config).value_or(QDateTime());
}

int PomodoroSession::pomodoroNumber() const
{
    if (!m_session) {
        return 0;
    }
    return m_session->phase.kind == PhaseKind::Work ? m_session->phase.completed + 1 : m_session->phase.completed;
}

int PomodoroSession::longRestEvery() const
{
    return m_session ? m_session->config.longRestEvery : 0;
}

QString PomodoroSession::nextPhase() const
{
    if (!m_session) {
        return QString();
    }
    const std::optional<TransitionKind> transition = transitionKind(m_session->phase, m_session->config);
    return transition ? nextPhaseName(*transition) : QString();
}

qint64 PomodoroSession::remainingSeconds() const
{
    return m_remaining;
}

qint64 PomodoroSession::overtimeSeconds() const
{
    return m_overtime;
}

QString PomodoroSession::countdownText() const
{
    return m_countdown;
}

bool PomodoroSession::isRinging() const
{
    return m_ringing;
}

QString PomodoroSession::ringingTransition() const
{
    return m_ringingTransition;
}

bool PomodoroSession::canStartSession() const
{
    return m_canStart;
}

QString PomodoroSession::message() const
{
    return m_message;
}

QString PomodoroSession::formatCountdown(qint64 seconds, bool overtime)
{
    seconds = std::max<qint64>(0, seconds);
    const QString text = QStringLiteral("%1:%2").arg(seconds / 60).arg(seconds % 60, 2, 10, QLatin1Char('0'));
    return overtime ? QLatin1Char('+') + text : text;
}

// ----- actions -------------------------------------------------------------

PomodoroSession::Activation PomodoroSession::activate()
{
    const bool timerHeld = m_timer && (m_timer->isRunning() || m_timer->isPaused());
    if (timerHeld || !m_pomodoroMode) {
        if (m_timer) {
            m_timer->toggle();
        }
        return Activation::Handled;
    }
    if (!m_session) {
        return startSession() ? Activation::Handled : Activation::Ignored;
    }
    if (m_ringing) {
        confirmNextPhase();
        return Activation::Handled;
    }
    return Activation::OpenMenu;
}

bool PomodoroSession::startSession()
{
    if (!m_canStart) {
        return false;
    }
    m_startAt = m_clock->now();
    if (!m_preferences) {
        begin(m_startAt);
        return true;
    }
    // The lengths are read once more; the session starts when the read
    // ends, with what it returned or with the lengths last known.
    m_startPending = true;
    update();
    m_preferences->refresh();
    return true;
}

bool PomodoroSession::confirmNextPhase()
{
    if (!m_session || !m_clock) {
        return false;
    }
    // A clock set back since the phase started confirms at the phase start.
    const QDateTime at = std::max(m_clock->now(), m_session->phase.startedAt);
    const std::optional<PhaseChange> change = Tokkl::nextPhase(m_session->phase, at, m_session->config);
    if (!change) {
        return false;
    }
    PomodoroSessionRecord next = *m_session;
    next.revision += 1;
    next.phase = change->next;
    const bool completes = change->next.kind == PhaseKind::Work;
    std::optional<UnsavedPomodoro> item;
    if (completes) {
        item = snapshot(at);
        next.pomodoroStart = at;
    }
    if (!write(next, item)) {
        return false;
    }
    m_session = next;
    m_ringing = false;
    if (completes && !item) {
        setMessage(tr("This pomodoro was too short to save."));
    }
    update();
    return true;
}

bool PomodoroSession::endSession()
{
    if (!m_session || !m_clock) {
        return false;
    }
    return end(m_clock->now());
}

void PomodoroSession::clearMessage()
{
    if (m_queue) {
        m_queue->clearMessage();
    }
    setMessage(QString());
}

void PomodoroSession::resumed()
{
    updateClock();
}

// ----- session changes -----------------------------------------------------

void PomodoroSession::begin(const QDateTime &at)
{
    PomodoroConfig config = m_preferences ? m_preferences->config() : PomodoroConfig();
    if (!config.isValid()) {
        config = PomodoroConfig();
    }
    PomodoroSessionRecord session;
    session.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    session.config = config;
    session.projectId = chosenProject();
    session.billable = m_timer->chosenBillable();
    session.phase = Tokkl::startSession(at).value_or(SessionPhase{PhaseKind::Work, at, 0});
    session.pomodoroStart = at;
    if (write(session, std::nullopt)) {
        m_session = session;
        m_ringing = false;
    }
    update();
}

bool PomodoroSession::end(const QDateTime &at)
{
    const QDateTime endAt = std::max(at, m_session->pomodoroStart);
    const std::optional<UnsavedPomodoro> item = snapshot(endAt);
    if (!write(std::nullopt, item)) {
        return false;
    }
    m_session.reset();
    m_ringing = false;
    if (!item) {
        setMessage(tr("This pomodoro was too short to save."));
    }
    update();
    return true;
}

std::optional<UnsavedPomodoro> PomodoroSession::snapshot(const QDateTime &end)
{
    const std::optional<Me> account = m_connection ? m_connection->account() : std::nullopt;
    const int minutes = account ? account->timeResolutionMinutes : 1;
    const QDateTime start = m_session->pomodoroStart;
    std::optional<std::optional<SnappedSpan>> span = pomodoroEntrySpan(start, end, minutes, account ? account->timezone : QString());
    if (!span) {
        // The zone is missing or unknown; the grid in UTC keeps the entry.
        span = pomodoroEntrySpan(start, end, minutes, QStringLiteral("UTC"));
    }
    if (!span || !*span) {
        return std::nullopt;
    }
    UnsavedPomodoro item;
    item.id = m_session->id + QLatin1Char(':') + QString::number(start.toMSecsSinceEpoch());
    item.owner = m_owner;
    item.workspaceId = m_connection ? m_connection->workspaceId() : 0;
    item.start = (*span)->start;
    item.stop = (*span)->stop;
    item.duration = item.start.secsTo(item.stop);
    item.projectId = m_session->projectId;
    item.billable = m_session->billable;
    // Due now, so the queue posts it at once.
    item.retryAt = m_clock ? m_clock->now() : end;
    return item;
}

bool PomodoroSession::write(const std::optional<PomodoroSessionRecord> &session, const std::optional<UnsavedPomodoro> &item)
{
    if (item) {
        return m_queue && m_queue->enqueue(*item, session);
    }
    if (!m_store || m_owner.isEmpty()) {
        return false;
    }
    PomodoroRecord record = PomodoroRecord::fromJson(m_store->loadRecord(m_owner));
    record.session = session;
    return m_store->saveRecord(m_owner, record.toJson());
}

std::optional<qint64> PomodoroSession::chosenProject() const
{
    const QVariant project = m_timer ? m_timer->chosenProjectId() : QVariant();
    if (project.isNull() || !project.isValid()) {
        return std::nullopt;
    }
    bool ok = false;
    const qint64 id = project.toLongLong(&ok);
    return ok && id > 0 ? std::optional<qint64>(id) : std::nullopt;
}

// ----- timer, connection and clock -----------------------------------------

void PomodoroSession::onConnectionChanged()
{
    Connection *connection = m_timer ? m_timer->connection() : nullptr;
    if (connection != m_connection) {
        if (m_connection) {
            disconnect(m_connection, nullptr, this, nullptr);
        }
        m_connection = connection;
        if (m_connection) {
            connect(m_connection, &Connection::contextAboutToChange, this, &PomodoroSession::onContextAboutToChange);
        }
    }
    onContextChanged();
}

void PomodoroSession::onContextChanged()
{
    followOwner();
    update();
}

void PomodoroSession::onContextAboutToChange()
{
    // The old account is still bound: its session ends and its pomodoros
    // are posted with its credentials.
    if (m_session && m_clock) {
        end(m_clock->now());
    }
    m_startPending = false;
    if (m_queue) {
        m_queue->flushForSignOut();
    }
}

void PomodoroSession::followOwner()
{
    const QString owner = this->owner();
    if (owner == m_owner) {
        return;
    }
    m_owner = owner;
    m_startPending = false;
    m_session.reset();
    m_ringing = false;
    if (m_store && !m_owner.isEmpty()) {
        const PomodoroRecord record = PomodoroRecord::fromJson(m_store->loadRecord(m_owner));
        if (record.session && !record.session->ending) {
            m_session = record.session;
        }
    }
    // The timer may already show the entry of another client.
    onEntryChanged();
}

QString PomodoroSession::owner() const
{
    return m_connection ? m_connection->owner() : QString();
}

bool PomodoroSession::accountBound() const
{
    return m_timer && m_timer->isConnected() && !owner().isEmpty();
}

void PomodoroSession::onEntryChanged()
{
    if (m_session && m_timer) {
        const std::optional<TimeEntry> entry = m_timer->currentEntry();
        if (entry && entry->isRunning() && entry->start > m_session->pomodoroStart && end(entry->start)) {
            return;
        }
    }
    update();
}

void PomodoroSession::onChoiceChanged()
{
    if (!m_session || !m_timer || m_timer->isRunning() || m_timer->isPaused()) {
        return;
    }
    const std::optional<qint64> project = chosenProject();
    const bool billable = m_timer->chosenBillable();
    if (project == m_session->projectId && billable == m_session->billable) {
        return;
    }
    PomodoroSessionRecord next = *m_session;
    next.projectId = project;
    next.billable = billable;
    if (write(next, std::nullopt)) {
        m_session = next;
    }
}

void PomodoroSession::onRefreshed(bool ok)
{
    Q_UNUSED(ok)
    if (!m_startPending) {
        return;
    }
    m_startPending = false;
    // A timer may have appeared or the account gone while the read ran.
    const bool startable = m_pomodoroMode && !m_session && accountBound() && m_timer && !m_timer->isRunning() && !m_timer->isPaused();
    if (startable) {
        begin(m_startAt);
    } else {
        update();
    }
}

void PomodoroSession::onTick()
{
    updateClock();
}

void PomodoroSession::update()
{
    const bool timerHeld = m_timer && (m_timer->isRunning() || m_timer->isPaused());
    const bool locked = timerHeld || m_session.has_value();
    const bool canStart = m_pomodoroMode && !m_session && !m_startPending && !timerHeld && accountBound() && m_clock && m_timer;
    if (locked != m_modeLocked) {
        m_modeLocked = locked;
        Q_EMIT modeLockedChanged();
    }
    if (canStart != m_canStart) {
        m_canStart = canStart;
        Q_EMIT canStartSessionChanged();
    }
    if (m_session != m_published) {
        m_published = m_session;
        Q_EMIT sessionChanged();
    }
    updateClock();
}

void PomodoroSession::updateClock()
{
    qint64 remaining = 0;
    qint64 overtime = 0;
    QString text;
    bool ringing = false;
    QString transition;
    if (m_session && m_clock) {
        const std::optional<QDateTime> end = Tokkl::plannedEnd(m_session->phase, m_session->config);
        const qint64 ms = end ? m_clock->now().msecsTo(*end) : 0;
        if (ms > 0) {
            remaining = (ms + 999) / 1000;
            text = formatCountdown(remaining, false);
        } else {
            overtime = -ms / 1000;
            text = formatCountdown(overtime, true);
        }
        // Once rung, a phase rings until it is confirmed, also if the clock
        // is set back.
        ringing = ms <= 0 || m_ringing;
        if (ringing) {
            const std::optional<TransitionKind> kind = transitionKind(m_session->phase, m_session->config);
            transition = kind ? transitionKindName(*kind) : QString();
        }
    }
    if (remaining != m_remaining || overtime != m_overtime || text != m_countdown) {
        m_remaining = remaining;
        m_overtime = overtime;
        m_countdown = text;
        Q_EMIT countdownChanged();
    }
    if (ringing != m_ringing || transition != m_ringingTransition) {
        m_ringing = ringing;
        m_ringingTransition = transition;
        Q_EMIT ringingChanged();
    }
}

void PomodoroSession::setMessage(const QString &message)
{
    if (message == m_message) {
        return;
    }
    m_message = message;
    Q_EMIT messageChanged();
}

}
