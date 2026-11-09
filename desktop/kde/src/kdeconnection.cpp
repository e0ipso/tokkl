#include "kdeconnection.h"

#include "clock.h"
#include "kwalletcredentialstore.h"
#include "transport.h"

namespace Tokkl
{

namespace
{
// The User-Agent product and the created_with value of the KDE widget.
QString clientName()
{
    return QStringLiteral("tokkl-kde");
}
}

KdeConnection::KdeConnection(QObject *parent)
    : KdeConnection(new NetworkTransport(clientName()), new SystemClock, parent)
{
}

// The connection owns the transport and the clock it is given here. As
// children they go after the session that uses them.
KdeConnection::KdeConnection(NetworkTransport *transport, SystemClock *clock, QObject *parent)
    : Connection(transport, KWalletCredentialStore::shared(), *clock, clientName(), parent)
{
    transport->setParent(this);
    clock->setParent(this);
}

KdeConnectionSetup::KdeConnectionSetup(QObject *parent)
    : KdeConnectionSetup(new NetworkTransport(clientName()), parent)
{
}

KdeConnectionSetup::KdeConnectionSetup(NetworkTransport *transport, QObject *parent)
    : ConnectionSetup(transport, KWalletCredentialStore::shared(), parent)
{
    transport->setParent(this);
}

}
