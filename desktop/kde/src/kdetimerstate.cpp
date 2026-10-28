#include "kdetimerstate.h"

namespace Tokkl
{

KdeTimerState::KdeTimerState(QObject *parent)
    : QObject(parent)
{
}

KdeTimerState::~KdeTimerState() = default;

Connection *KdeTimerState::connection() const
{
    return m_connection;
}

void KdeTimerState::setConnection(Connection *connection)
{
    if (connection == m_connection) {
        return;
    }
    m_connection = connection;
    // The new client is in place before the old one goes, so a listener of
    // clientChanged() never sees a client that is being deleted.
    std::unique_ptr<TimerStateClient> previous = std::move(m_client);
    if (connection) {
        m_client = std::make_unique<TimerStateClient>(connection, &m_clock);
    }
    Q_EMIT connectionChanged();
    Q_EMIT clientChanged();
}

TimerStateClient *KdeTimerState::client() const
{
    return m_client.get();
}

}
