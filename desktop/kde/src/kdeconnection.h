#pragma once

// The connection and the Configure page backend as the KDE widget creates
// them from QML: with KDE Wallet and the network.

#include "connection.h"
#include "connectionsetup.h"

namespace Tokkl
{

class NetworkTransport;

class KdeConnection : public Connection
{
    Q_OBJECT

public:
    explicit KdeConnection(QObject *parent = nullptr);

private:
    KdeConnection(NetworkTransport *transport, QObject *parent);
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
