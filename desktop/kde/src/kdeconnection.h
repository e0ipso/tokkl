#pragma once

// The connection and the Configure page backend as the KDE widget creates
// them from QML: with KDE Wallet and the network.

#include "connection.h"
#include "connectionsetup.h"

namespace Tokkl
{

class NetworkTransport;
class SystemClock;

// Owns its transport and its system clock.
class KdeConnection : public Connection
{
    Q_OBJECT

public:
    explicit KdeConnection(QObject *parent = nullptr);

private:
    KdeConnection(NetworkTransport *transport, SystemClock *clock, QObject *parent);
};

class KdeConnectionSetup : public ConnectionSetup
{
    Q_OBJECT

public:
    explicit KdeConnectionSetup(QObject *parent = nullptr);

private:
    KdeConnectionSetup(NetworkTransport *transport, QObject *parent);
};

}
