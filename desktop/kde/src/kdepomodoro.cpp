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
    // While m_timer is still the old timer, so the session leaves it.
    const bool hadSession = m_session;
    release();
    m_timer = timer;
    if (m_timer) {
        // The timer's state client is set after the timer exists.
        connect(m_timer, &TimerController::connectionChanged, this, &KdePomodoro::build);
    }
    Q_EMIT timerChanged();
    build();
    if (hadSession && !m_session) {
        Q_EMIT sessionChanged();
    }
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

void KdePomodoro::release()
{
    if (m_session) {
        if (m_timer) {
            disconnect(m_timer, nullptr, m_session, nullptr);
        }
        if (m_client) {
            disconnect(m_client, nullptr, m_session, nullptr);
            if (Clock *clock = m_client->clock()) {
                disconnect(clock, nullptr, m_session, nullptr);
            }
        }
        m_session->deleteLater();
    }
    if (m_preferences) {
        m_preferences->deleteLater();
    }
    m_session = nullptr;
    m_preferences = nullptr;
    m_client = nullptr;
    m_builtStore = nullptr;
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
            release();
            Q_EMIT sessionChanged();
        }
        return;
    }
    if (m_session && client == m_client && m_store == m_builtStore) {
        return; // built on these already
    }
    release();
    m_client = client;
    m_builtStore = m_store;
    m_preferences = new PomodoroPreferences(client->connection(), this);
    m_session = new PomodoroSession(client->clock(), m_timer, client, m_store, this);
    Q_EMIT sessionChanged();
}

}
