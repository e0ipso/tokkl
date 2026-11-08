#include "connectionsettings.h"

#include "connection.h"
#include "logging.h"

#include <QSettings>

#include <memory>

namespace Tokkl
{

namespace
{
// A settings object on the same file or domain as settings, with a status
// of its own. QSettings keeps the first error it meets, so settings that
// failed once would report every later write as failed. Objects on one
// file share their values within the process, so what is written here,
// and what the caller set on settings before, reaches both.
std::unique_ptr<QSettings> sameStore(const QSettings &settings)
{
    // Only the constructors that take an organization or application name
    // give one; a settings object made on a file path has neither.
    if (settings.organizationName().isEmpty() && settings.applicationName().isEmpty()) {
        return std::make_unique<QSettings>(settings.fileName(), settings.format());
    }
    return std::make_unique<QSettings>(settings.format(), settings.scope(), settings.organizationName(), settings.applicationName());
}
}

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
    const std::unique_ptr<QSettings> store = sameStore(settings);
    const QLatin1StringView keys[] = {instanceUrlKey, authModeKey, emailKey};
    const QString values[] = {instanceUrl, authMode, email};
    QVariant before[3];
    for (int i = 0; i < 3; ++i) {
        before[i] = store->value(keys[i]);
        store->setValue(keys[i], values[i]);
    }
    store->sync();
    if (store->status() == QSettings::NoError) {
        return true;
    }
    qCWarning(lcAuth) << "Could not save the connection settings to" << store->fileName();
    for (int i = 0; i < 3; ++i) {
        if (before[i].isValid()) {
            store->setValue(keys[i], before[i]);
        } else {
            store->remove(keys[i]);
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
