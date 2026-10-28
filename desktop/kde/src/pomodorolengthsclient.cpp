#include "pomodorolengthsclient.h"

#include "kdeconnection.h"

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
