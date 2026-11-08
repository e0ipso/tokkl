#include "menuactions.h"

#include "pomodorosession.h"
#include "timermodel.h"

namespace Tokkl
{

QVariantMap ActionState::toVariantMap() const
{
    return {
        {QStringLiteral("visible"), visible},
        {QStringLiteral("enabled"), enabled},
        {QStringLiteral("label"), label},
    };
}

MenuActionPolicy MenuActionPolicy::plasma()
{
    return {WriteGate::CanWrite};
}

MenuActionPolicy MenuActionPolicy::macos()
{
    return {WriteGate::CanWrite};
}

MenuActionPolicy MenuActionPolicy::gnome()
{
    return {WriteGate::Ready};
}

MenuActionStates MenuActionStates::of(const TimerModel &timer, const PomodoroSession *session, const MenuActionPolicy &policy)
{
    const bool running = timer.isRunning();
    const bool paused = timer.isPaused();
    const bool held = running || paused;
    // The session reads the timer's own state client, so it is active
    // exactly when the timer shows a session.
    const bool active = session && session->isActive();
    const bool pomodoroIdle = session && session->pomodoroMode() && !held;
    const bool gateOpen = policy.writeGate == MenuActionPolicy::WriteGate::CanWrite || timer.status() == TimerModel::Ready;
    const bool writable = gateOpen && timer.canWrite();

    MenuActionStates states;
    states.run.visible = !pomodoroIdle && !active;
    // Stop while paused discards the chain on the server, so it needs a
    // connection like any other write.
    states.run.enabled = states.run.visible && writable;
    states.run.label = held ? QStringLiteral("stop") : QStringLiteral("start");

    states.startSession.visible = pomodoroIdle && !active;
    states.startSession.enabled = states.startSession.visible && session->canStartSession();
    states.startSession.label = QStringLiteral("startSession");

    states.nextPhase.visible = active;
    states.nextPhase.enabled = active;
    states.nextPhase.label = active ? session->nextPhase() : QString();

    states.endSession.visible = active;
    states.endSession.enabled = active;
    states.endSession.label = QStringLiteral("endSession");

    states.project.enabled = gateOpen && timer.canChooseProject();
    if (running) {
        states.project.label = QStringLiteral("projectRunning");
    } else if (paused) {
        states.project.label = QStringLiteral("projectPaused");
    } else {
        states.project.label = QStringLiteral("project");
    }

    states.billable.enabled = gateOpen && timer.canChooseBillable();
    states.billable.label = QStringLiteral("billable");

    const bool locked = session && session->modeLocked();
    states.mode.enabled = session && !locked;
    states.mode.label = locked ? QStringLiteral("pomodoroModeLocked") : QStringLiteral("pomodoroMode");
    return states;
}

QVariantMap MenuActionStates::toVariantMap() const
{
    return {
        {QStringLiteral("run"), run.toVariantMap()},
        {QStringLiteral("startSession"), startSession.toVariantMap()},
        {QStringLiteral("nextPhase"), nextPhase.toVariantMap()},
        {QStringLiteral("endSession"), endSession.toVariantMap()},
        {QStringLiteral("project"), project.toVariantMap()},
        {QStringLiteral("billable"), billable.toVariantMap()},
        {QStringLiteral("mode"), mode.toVariantMap()},
    };
}

MenuActions::MenuActions(QObject *parent)
    : MenuActions(MenuActionPolicy::plasma(), parent)
{
}

MenuActions::MenuActions(const MenuActionPolicy &policy, QObject *parent)
    : QObject(parent)
    , m_policy(policy)
{
}

TimerModel *MenuActions::timer() const
{
    return m_timer;
}

void MenuActions::setTimer(TimerModel *timer)
{
    if (timer == m_timer) {
        return;
    }
    if (m_timer) {
        disconnect(m_timer, nullptr, this, nullptr);
    }
    m_timer = timer;
    if (m_timer) {
        for (auto signal : {&TimerModel::statusChanged,
                            &TimerModel::currentEntryChanged,
                            &TimerModel::chainChanged,
                            &TimerModel::sessionActiveChanged,
                            &TimerModel::contextChanged}) {
            connect(m_timer, signal, this, &MenuActions::update);
        }
        connect(m_timer, &QObject::destroyed, this, &MenuActions::update);
    }
    Q_EMIT timerChanged();
    update();
}

PomodoroSession *MenuActions::session() const
{
    return m_session;
}

void MenuActions::setSession(PomodoroSession *session)
{
    if (session == m_session) {
        return;
    }
    if (m_session) {
        disconnect(m_session, nullptr, this, nullptr);
    }
    m_session = session;
    if (m_session) {
        for (auto signal : {&PomodoroSession::modeChanged,
                            &PomodoroSession::modeLockedChanged,
                            &PomodoroSession::sessionChanged,
                            &PomodoroSession::canStartSessionChanged}) {
            connect(m_session, signal, this, &MenuActions::update);
        }
        connect(m_session, &QObject::destroyed, this, &MenuActions::update);
    }
    Q_EMIT sessionChanged();
    update();
}

const MenuActionStates &MenuActions::states() const
{
    return m_states;
}

QVariantMap MenuActions::statesVariant() const
{
    return m_states.toVariantMap();
}

void MenuActions::update()
{
    const MenuActionStates states = m_timer ? MenuActionStates::of(*m_timer, m_session, m_policy) : MenuActionStates();
    if (states != m_states) {
        m_states = states;
        Q_EMIT changed();
    }
}

}
