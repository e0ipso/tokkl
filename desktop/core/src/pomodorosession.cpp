#include "pomodorosession.h"

#include <algorithm>

namespace Tokkl
{

PomodoroSession::PomodoroSession(Clock &clock, TimerActions &timer, SessionState &state, PomodoroStore &store, QObject *parent)
    : QObject(parent)
    , m_timer(timer)
    , m_client(state)
    , m_store(store)
    , m_pomodoroMode(store.loadPomodoroMode())
{
    connect(&m_store, &PomodoroStore::sourceChanged, this, &PomodoroSession::reloadMode);
    connect(&clock, &Clock::ticked, this, &PomodoroSession::updateClock);
    connect(&m_client, &SessionState::stateChanged, this, &PomodoroSession::onStateChanged);
    connect(&m_client, &SessionState::settlingChanged, this, &PomodoroSession::update);
    connect(&m_client, &SessionState::accountReset, this, &PomodoroSession::onAccountReset);
    connect(&m_client, &SessionState::woke, this, &PomodoroSession::updateClock);
    connect(&m_timer, &TimerActions::changed, this, &PomodoroSession::update);
    onStateChanged();
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
    if (!m_store.savePomodoroMode(pomodoro)) {
        return false;
    }
    m_pomodoroMode = pomodoro;
    Q_EMIT modeChanged();
    update();
    return true;
}

void PomodoroSession::reloadMode()
{
    const bool stored = m_store.loadPomodoroMode();
    if (stored == m_pomodoroMode) {
        return;
    }
    m_pomodoroMode = stored;
    Q_EMIT modeChanged();
    update();
}

bool PomodoroSession::modeLocked() const
{
    return m_modeLocked;
}

bool PomodoroSession::isActive() const
{
    return m_view.active;
}

QString PomodoroSession::phase() const
{
    return m_view.phase;
}

QDateTime PomodoroSession::phaseStart() const
{
    return m_view.phaseStart;
}

QDateTime PomodoroSession::plannedEnd() const
{
    return m_view.plannedEnd;
}

int PomodoroSession::pomodoroNumber() const
{
    return m_view.pomodoroNumber;
}

int PomodoroSession::longRestEvery() const
{
    return m_view.longRestEvery;
}

QString PomodoroSession::nextPhase() const
{
    return m_view.nextPhase;
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

PrimaryAction PomodoroSession::primaryAction() const
{
    if (pomodoro()) {
        return PrimaryAction::Session;
    }
    if (timerHeld() || !m_pomodoroMode) {
        return m_timer.toggleAction();
    }
    return PrimaryAction::StartSession;
}

PomodoroSession::Activation PomodoroSession::activate()
{
    switch (primaryAction()) {
    case PrimaryAction::Session:
        if (!m_ringing) {
            return Activation::OpenMenu;
        }
        return confirmNextPhase() ? Activation::Handled : Activation::Ignored;
    case PrimaryAction::StartSession:
        return startSession() ? Activation::Handled : Activation::Ignored;
    default:
        return m_timer.toggle() ? Activation::Handled : Activation::Ignored;
    }
}

bool PomodoroSession::startSession()
{
    if (!m_canStart) {
        return false;
    }
    const TimerActions::Selection selection = m_timer.selection();
    PomodoroStart start;
    start.projectId = selection.projectId;
    start.billable = selection.billable;
    clearMessage();
    m_pending = true;
    update();
    m_client.startPomodoro(start, finishing());
    return true;
}

bool PomodoroSession::confirmNextPhase()
{
    return sendWithRevision(&SessionState::nextPhase);
}

bool PomodoroSession::endSession()
{
    return sendWithRevision(&SessionState::endPomodoro);
}

bool PomodoroSession::sendWithRevision(void (SessionState::*action)(SessionState::ActionCallback))
{
    if (!pomodoro() || busy()) {
        return false;
    }
    clearMessage();
    m_pending = true;
    update();
    (m_client.*action)(finishing());
    return true;
}

SessionState::ActionCallback PomodoroSession::finishing()
{
    return m_epoch.guard(this, [this](const TimerActionResult &result) {
        m_pending = false;
        // An applied action or a 409 already shows its state; otherwise tell the
        // user why nothing happened, or that the outcome is being settled.
        using Outcome = TimerActionResult::Outcome;
        if (result.outcome == Outcome::Refused || result.outcome == Outcome::Unknown) {
            setMessage(result.error.message);
        }
        update();
    });
}

void PomodoroSession::onAccountReset()
{
    // Another instance, account or credential: the pending action and its
    // message belonged to the earlier one.
    m_epoch.advance();
    m_pending = false;
    clearMessage();
    update();
}

void PomodoroSession::clearMessage()
{
    setMessage(QString());
}

const TimerPomodoro *PomodoroSession::pomodoro() const
{
    if (!m_client.state() || !m_client.state()->pomodoro) {
        return nullptr;
    }
    return &*m_client.state()->pomodoro;
}

bool PomodoroSession::timerHeld() const
{
    return m_timer.holdsEntry();
}

bool PomodoroSession::busy() const
{
    return m_pending || m_client.settling() || m_timer.isBusy();
}

void PomodoroSession::onStateChanged()
{
    const std::optional<DiscardedPomodoro> discarded = m_client.state() ? m_client.state()->discardedPomodoro : std::nullopt;
    if (discarded && discarded->entryId != m_discardedEntry) {
        m_discardedEntry = discarded->entryId;
        setMessage(tr("This pomodoro was too short to save."));
    }
    update();
}

void PomodoroSession::update()
{
    const TimerPomodoro *session = pomodoro();
    View view;
    if (session) {
        // The server's instants on this device's clock.
        const qint64 offset = m_client.serverOffsetMs();
        view.active = true;
        view.phase = phaseKindName(session->phase.kind);
        view.phaseStart = session->phase.start.addMSecs(-offset);
        view.plannedEnd = session->phase.plannedEnd.addMSecs(-offset);
        view.pomodoroNumber = session->number;
        view.longRestEvery = session->config.longRestEvery;
        view.nextPhase = phaseKindName(session->upcomingPhase);
    }

    // The timer reads the same client, so it sees a session exactly when
    // this does.
    const bool sessionActive = session != nullptr;
    const bool locked = timerHeld() || sessionActive;
    // The timer says whether anything new may start; a session adds the
    // mode, its own action and its own view of the state.
    const bool canStart = m_pomodoroMode && !sessionActive && !busy() && m_timer.canStartNew();
    if (locked != m_modeLocked) {
        m_modeLocked = locked;
        Q_EMIT modeLockedChanged();
    }
    if (canStart != m_canStart) {
        m_canStart = canStart;
        Q_EMIT canStartSessionChanged();
    }
    if (view != m_view) {
        m_view = view;
        Q_EMIT sessionChanged();
    }
    updateClock();
}

void PomodoroSession::updateClock()
{
    const TimerPomodoro *session = pomodoro();
    qint64 remaining = 0;
    qint64 overtime = 0;
    QString text;
    bool ringing = false;
    QString transition;
    if (session) {
        const qint64 ms = m_client.serverNow().msecsTo(session->phase.plannedEnd);
        if (ms > 0) {
            remaining = (ms + 999) / 1000;
            text = formatCountdown(remaining, false);
        } else {
            overtime = -ms / 1000;
            text = formatCountdown(overtime, true);
        }
        ringing = ms <= 0 || m_rangPhase == session->phase.start;
        if (ringing) {
            m_rangPhase = session->phase.start;
            transition = transitionKindName(session->transition);
        }
    } else {
        m_rangPhase = QDateTime();
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
