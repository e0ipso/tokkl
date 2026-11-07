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
    const QLatin1StringView keys[] = {instanceUrlKey, authModeKey, emailKey};
    const QString values[] = {instanceUrl, authMode, email};
    QVariant before[3];
    for (int i = 0; i < 3; ++i) {
        before[i] = settings.value(keys[i]);
        settings.setValue(keys[i], values[i]);
    }
    settings.sync();
    if (settings.status() == QSettings::NoError) {
        return true;
    }
    qCWarning(lcAuth) << "Could not save the connection settings to" << settings.fileName();
    for (int i = 0; i < 3; ++i) {
        if (before[i].isValid()) {
            settings.setValue(keys[i], before[i]);
        } else {
            settings.remove(keys[i]);
        }
    }
    return false;
}

void ConnectionSettings::applyTo(Connection &connection) const
{
    connection.setInstanceUrl(instanceUrl);
    connection.setAuthModeString(authMode);
    connection.setEmail(email);
}

}
