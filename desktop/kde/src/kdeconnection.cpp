#include "kdeconnection.h"

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
    : KdeConnection(new NetworkTransport(clientName()), parent)
{
}

// The connection owns the transport it is given here.
KdeConnection::KdeConnection(NetworkTransport *transport, QObject *parent)
    : Connection(transport, KWalletCredentialStore::shared(), clientName(), parent)
{
    transport->setParent(this);
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
