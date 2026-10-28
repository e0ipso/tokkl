#include "kdepomodoro.h"

namespace Tokkl
{

KdePomodoro::KdePomodoro(QObject *parent)
    : QObject(parent)
{
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
    if (m_timer) {
        disconnect(m_timer, &TimerController::connectionChanged, this, nullptr);
    }
    m_timer = timer;
    if (m_timer) {
        // The timer's state client is set after the timer exists.
        connect(m_timer, &TimerController::connectionChanged, this, &KdePomodoro::build);
    }
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

void KdePomodoro::clear()
{
    delete m_session;
    delete m_preferences;
    m_session = nullptr;
    m_preferences = nullptr;
}

void KdePomodoro::build()
{
    if (m_inDocument || !m_timer || !m_store) {
        return;
    }
    TimerStateClient *client = m_timer->stateClient();
    if (!client || !client->connection()) {
        // The timer lost its client: the session built on it goes too.
        if (m_session) {
            clear();
            Q_EMIT sessionChanged();
        }
        return;
    }
    clear();
    m_preferences = new PomodoroPreferences(client->connection(), this);
    m_session = new PomodoroSession(&m_clock, m_timer, client, m_store, this);
    Q_EMIT sessionChanged();
}

}
