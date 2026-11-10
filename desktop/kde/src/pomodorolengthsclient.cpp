#include "pomodorolengthsclient.h"

#include "kdeconnection.h"
#include "pomodorolengthssaves.h"

namespace Tokkl
{

PomodoroLengthsClient::PomodoroLengthsClient(QObject *parent)
    : PomodoroLengthsClient(new KdeConnection, parent)
{
}

PomodoroLengthsClient::PomodoroLengthsClient(Connection *connection, QObject *parent)
    : QObject(parent)
    , m_connection(connection)
    , m_preferences(new PomodoroPreferences(connection, this))
{
    m_connection->setParent(this);
    connect(m_connection, &Connection::stateChanged, this, [this] {
        const bool connecting = isConnecting();
        if (connecting != m_connecting) {
            m_connecting = connecting;
            Q_EMIT connectingChanged();
        }
    });
    m_connecting = isConnecting();
    connect(PomodoroLengthsSaves::instance(), &PomodoroLengthsSaves::answered, this, [this](PomodoroPreferences *preferences) {
        if (preferences == m_preferences) {
            Q_EMIT saveAnswered();
        }
    });
}

PomodoroLengthsClient::~PomodoroLengthsClient()
{
    PomodoroLengthsSaves::instance()->keepUntilAnswered(m_connection, m_preferences);
}

bool PomodoroLengthsClient::save(int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery)
{
    return PomodoroLengthsSaves::instance()->save(m_connection, m_preferences, workMinutes, shortRestMinutes, longRestMinutes, longRestEvery);
}

Connection *PomodoroLengthsClient::connection() const
{
    return m_connection;
}

PomodoroPreferences *PomodoroLengthsClient::preferences() const
{
    return m_preferences;
}

bool PomodoroLengthsClient::isConnecting() const
{
    const Connection::State state = m_connection->state();
    return state == Connection::LoadingCredentials || state == Connection::Connecting;
}

}
