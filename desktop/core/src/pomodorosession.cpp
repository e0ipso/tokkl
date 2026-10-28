#include "pomodorosession.h"

#include <algorithm>

namespace Tokkl
{

PomodoroSession::PomodoroSession(Clock *clock, TimerController *timer, TimerStateClient *client, PomodoroStore *store, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
    , m_timer(timer)
    , m_client(client)
    , m_store(store)
{
    if (m_store) {
        m_pomodoroMode = m_store->loadPomodoroMode();
    }
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &PomodoroSession::updateClock);
    }
    if (m_client) {
        connect(m_client, &TimerStateClient::stateChanged, this, &PomodoroSession::onStateChanged);
        connect(m_client, &TimerStateClient::settlingChanged, this, &PomodoroSession::update);
    }
    if (m_timer) {
        connect(m_timer, &TimerController::contextChanged, this, &PomodoroSession::update);
        connect(m_timer, &TimerController::statusChanged, this, &PomodoroSession::update);
        connect(m_timer, &TimerController::currentEntryChanged, this, &PomodoroSession::update);
        connect(m_timer, &TimerController::chainChanged, this, &PomodoroSession::update);
        connect(m_timer, &TimerController::sessionActiveChanged, this, &PomodoroSession::update);
    }
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

// ----- actions -------------------------------------------------------------

PomodoroSession::Activation PomodoroSession::activate()
{
    if (pomodoro()) {
        if (!m_ringing) {
            return Activation::OpenMenu;
        }
        return confirmNextPhase() ? Activation::Handled : Activation::Ignored;
    }
    if (timerHeld() || !m_pomodoroMode) {
        if (m_timer) {
            m_timer->toggle();
        }
        return Activation::Handled;
    }
    return startSession() ? Activation::Handled : Activation::Ignored;
}

bool PomodoroSession::startSession()
{
    if (!m_canStart) {
        return false;
    }
    PomodoroStart start;
    const QVariant project = m_timer->chosenProjectId();
    bool ok = false;
    const qint64 id = project.isValid() && !project.isNull() ? project.toLongLong(&ok) : 0;
    if (ok && id > 0) {
        start.projectId = id;
    }
    start.billable = m_timer->chosenBillable();
    clearMessage();
    m_pending = true;
    update();
    m_client->startPomodoro(start, finishing());
    return true;
}

bool PomodoroSession::confirmNextPhase()
{
    return sendWithRevision(&TimerStateClient::nextPhase);
}

bool PomodoroSession::endSession()
{
    return sendWithRevision(&TimerStateClient::endPomodoro);
}

bool PomodoroSession::sendWithRevision(void (TimerStateClient::*action)(TimerStateClient::ActionCallback))
{
    if (!pomodoro() || busy()) {
        return false;
    }
    clearMessage();
    m_pending = true;
    update();
    (m_client->*action)(finishing());
    return true;
}

TimerStateClient::ActionCallback PomodoroSession::finishing()
{
    QPointer<PomodoroSession> self(this);
    return [self](const TimerActionResult &result) {
        if (!self) {
            return;
        }
        self->m_pending = false;
        // The state of an applied action or of a 409 is already adopted and
        // shows what happened. Otherwise the user learns why nothing did, or
        // that the outcome is being settled.
        using Outcome = TimerActionResult::Outcome;
        if (result.outcome == Outcome::Refused || result.outcome == Outcome::Unknown) {
            self->setMessage(result.error.message);
        }
        self->update();
    };
}

void PomodoroSession::clearMessage()
{
    setMessage(QString());
}

void PomodoroSession::resumed()
{
    updateClock();
}

// ----- state, timer and clock ----------------------------------------------

const TimerPomodoro *PomodoroSession::pomodoro() const
{
    if (!m_client || !m_client->state() || !m_client->state()->pomodoro) {
        return nullptr;
    }
    return &*m_client->state()->pomodoro;
}

bool PomodoroSession::timerHeld() const
{
    return m_timer && (m_timer->isRunning() || m_timer->isPaused());
}

bool PomodoroSession::busy() const
{
    return m_pending || !m_client || m_client->settling() || (m_timer && m_timer->isBusy());
}

void PomodoroSession::onStateChanged()
{
    const std::optional<DiscardedPomodoro> discarded = m_client && m_client->state() ? m_client->state()->discardedPomodoro : std::nullopt;
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
        const qint64 offset = m_client->serverOffsetMs();
        view.active = true;
        view.phase = phaseKindName(session->phase.kind);
        view.phaseStart = session->phase.start.addMSecs(-offset);
        view.plannedEnd = session->phase.plannedEnd.addMSecs(-offset);
        view.pomodoroNumber = session->number;
        view.longRestEvery = session->config.longRestEvery;
        view.nextPhase = phaseKindName(session->upcomingPhase);
    }

    const bool sessionActive = session || (m_timer && m_timer->isSessionActive());
    const bool locked = timerHeld() || sessionActive;
    const bool canStart = m_pomodoroMode && !sessionActive && !timerHeld() && !busy() && m_clock && m_timer && m_timer->isConnected() && m_client
        && m_client->state().has_value();
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
        const qint64 ms = m_client->serverNow().msecsTo(session->phase.plannedEnd);
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
