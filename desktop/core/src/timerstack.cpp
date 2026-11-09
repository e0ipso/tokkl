#include "timerstack.h"

namespace Tokkl
{

TimerStack::TimerStack(Transport *transport,
                       CredentialStore *credentials,
                       PomodoroStore &pomodoroStore,
                       Clock &clock,
                       const QString &clientName,
                       QObject *parent)
    : QObject(parent)
    , m_connection(transport, credentials, clock, clientName, this)
    , m_stateClient(m_connection, clock, this)
    , m_timer(clock, this)
    , m_preferences(&m_connection, this)
    , m_session(clock, *boundTimer(), m_stateClient, pomodoroStore, this)
{
}

TimerStack::~TimerStack() = default;

TimerCoordinator *TimerStack::boundTimer()
{
    m_timer.setStateClient(&m_stateClient);
    return m_timer.coordinator();
}

Connection *TimerStack::connection()
{
    return &m_connection;
}

TimerController *TimerStack::timer()
{
    return &m_timer;
}

PomodoroPreferences *TimerStack::preferences()
{
    return &m_preferences;
}

PomodoroSession *TimerStack::session()
{
    return &m_session;
}

}
