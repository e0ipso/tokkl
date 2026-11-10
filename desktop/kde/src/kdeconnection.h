#pragma once

#include "connection.h"
#include "connectionsetup.h"

namespace Tokkl
{

class NetworkTransport;
class SystemClock;

QString kdeClientName();

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
