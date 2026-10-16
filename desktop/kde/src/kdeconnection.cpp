#include "kdeconnection.h"

#include "kwalletcredentialstore.h"
#include "transport.h"

namespace Tokkl
{

KdeConnection::KdeConnection(QObject *parent)
    : KdeConnection(new NetworkTransport, parent)
{
}

// The connection owns the transport it is given here.
KdeConnection::KdeConnection(NetworkTransport *transport, QObject *parent)
    : Connection(transport, KWalletCredentialStore::shared(), parent)
{
    transport->setParent(this);
}

KdeConnectionSetup::KdeConnectionSetup(QObject *parent)
    : KdeConnectionSetup(new NetworkTransport, parent)
{
}

KdeConnectionSetup::KdeConnectionSetup(NetworkTransport *transport, QObject *parent)
    : ConnectionSetup(transport, KWalletCredentialStore::shared(), parent)
{
    transport->setParent(this);
}

}
