#include "kdeconnection.h"

#include "clock.h"
#include "kwalletcredentialstore.h"
#include "transport.h"

namespace Tokkl
{

QString kdeClientName()
{
    return QStringLiteral("tokkl-kde");
}

KdeConnection::KdeConnection(QObject *parent)
    : KdeConnection(new NetworkTransport(kdeClientName()), new SystemClock, parent)
{
}

// As children of the connection, the transport and clock outlive the
// session that uses them.
KdeConnection::KdeConnection(NetworkTransport *transport, SystemClock *clock, QObject *parent)
    : Connection(transport, KWalletCredentialStore::shared(), *clock, kdeClientName(), parent)
{
    transport->setParent(this);
    clock->setParent(this);
}

KdeConnectionSetup::KdeConnectionSetup(QObject *parent)
    : KdeConnectionSetup(new NetworkTransport(kdeClientName()), parent)
{
}

KdeConnectionSetup::KdeConnectionSetup(NetworkTransport *transport, QObject *parent)
    : ConnectionSetup(transport, KWalletCredentialStore::shared(), parent)
{
    transport->setParent(this);
}

}
