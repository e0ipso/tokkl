#include "kdepomodoro.h"

namespace Tokkl
{

KdePomodoro::KdePomodoro(QObject *parent)
    : QObject(parent)
{
}

Connection *KdePomodoro::connection() const
{
    return m_connection;
}

void KdePomodoro::setConnection(Connection *connection)
{
    if (connection == m_connection) {
        return;
    }
    m_connection = connection;
    Q_EMIT connectionChanged();
    build();
}

TimerController *KdePomodoro::timer() const
{
    return m_timer;
}

void KdePomodoro::setTimer(TimerController *timer)
{
    if (timer == m_timer) {
        return;
    }
    m_timer = timer;
    Q_EMIT timerChanged();
    build();
}

PomodoroStore *KdePomodoro::store() const
{
    return m_store;
}

void KdePomodoro::setStore(PomodoroStore *store)
{
    if (store == m_store) {
        return;
    }
    m_store = store;
    Q_EMIT storeChanged();
    build();
}

PomodoroSession *KdePomodoro::session() const
{
    return m_session;
}

PomodoroPreferences *KdePomodoro::preferences() const
{
    return m_preferences;
}

void KdePomodoro::classBegin()
{
    m_inDocument = true;
}

void KdePomodoro::componentComplete()
{
    m_inDocument = false;
    build();
}

void KdePomodoro::build()
{
    if (m_inDocument || !m_connection || !m_timer || !m_store) {
        return;
    }
    // The session goes first: it still reads the others while it ends.
    delete m_session;
    delete m_queue;
    delete m_preferences;
    m_preferences = new PomodoroPreferences(m_connection, m_store, this);
    m_queue = new PomodoroQueue(m_connection, &m_clock, m_store, this);
    m_session = new PomodoroSession(&m_clock, m_timer, m_preferences, m_queue, m_store, this);
    Q_EMIT sessionChanged();
}

}
