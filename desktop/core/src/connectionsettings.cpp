#include "connectionsettings.h"

#include "connection.h"
#include "logging.h"

#include <QSettings>

namespace Tokkl
{

ConnectionSettings ConnectionSettings::read(const QSettings &settings)
{
    ConnectionSettings read;
    read.instanceUrl = settings.value(instanceUrlKey).toString();
    read.authMode = settings.value(authModeKey, read.authMode).toString();
    read.email = settings.value(emailKey).toString();
    return read;
}

bool ConnectionSettings::write(QSettings &settings) const
{
    settings.setValue(instanceUrlKey, instanceUrl);
    settings.setValue(authModeKey, authMode);
    settings.setValue(emailKey, email);
    settings.sync();
    if (settings.status() != QSettings::NoError) {
        qCWarning(lcAuth) << "Could not save the connection settings to" << settings.fileName();
        return false;
    }
    return true;
}

void ConnectionSettings::applyTo(Connection &connection) const
{
    connection.setInstanceUrl(instanceUrl);
    connection.setAuthModeString(authMode);
    connection.setEmail(email);
}

}
