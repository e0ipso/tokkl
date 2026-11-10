#include "connectionsettings.h"

#include "connection.h"
#include "logging.h"
#include "settingswrite.h"

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
    if (writeSettings(settings, {{instanceUrlKey, instanceUrl}, {authModeKey, authMode}, {emailKey, email}})) {
        return true;
    }
    qCWarning(lcAuth) << "Could not save the connection settings to" << settings.fileName();
    return false;
}

void ConnectionSettings::applyTo(Connection &connection) const
{
    connection.setInstanceUrl(instanceUrl);
    connection.setAuthModeString(authMode);
    connection.setEmail(email);
}

}
