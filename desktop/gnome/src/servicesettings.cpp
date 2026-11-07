#include "servicesettings.h"

#include "connection.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "logging.h"

#include <QSettings>

namespace Tokkl
{

namespace
{
using Kind = ServiceSettings::Outcome::Kind;

// Why configure() cannot use the settings, or empty when it can.
QString invalidReason(const InstanceUrl &instance, const QString &authMode, const QString &email)
{
    if (!instance.isValid()) {
        return instance.error;
    }
    if (authMode != QLatin1String("token") && authMode != QLatin1String("password")) {
        return ServiceSettings::tr("The sign-in method must be \"token\" or \"password\".");
    }
    if (authMode == QLatin1String("password") && email.trimmed().isEmpty()) {
        return ServiceSettings::tr("Enter the email address of your Tokkl account.");
    }
    return QString();
}
}

ServiceSettings::ServiceSettings(QSettings *settings, Connection *connection, CredentialStore *store, QObject *parent)
    : QObject(parent)
    , m_settings(settings)
    , m_connection(connection)
    , m_store(store)
{
}

void ServiceSettings::load()
{
    const ConnectionSettings settings = ConnectionSettings::read(*m_settings);
    if (!settings.instanceUrl.isEmpty()) {
        settings.applyTo(*m_connection);
    }
}

void ServiceSettings::configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret, Done done)
{
    const InstanceUrl instance = parseInstanceUrl(instanceUrl);
    const QString invalid = invalidReason(instance, authMode, email);
    if (!invalid.isEmpty()) {
        done(Outcome{Kind::Invalid, invalid});
        return;
    }

    const AuthMode mode = authModeFromString(authMode);
    // The same cleaning as the KDE Configure page: tokens never carry
    // surrounding whitespace, passwords are used exactly as typed.
    const QString cleaned = mode == AuthMode::Token ? secret.trimmed() : secret;
    const ConnectionSettings settings{instance.base.toString(), authMode, email.trimmed()};
    const quint64 serial = ++m_serial;
    if (cleaned.isEmpty()) {
        done(apply(settings) ? Outcome() : notWritten());
        return;
    }

    m_store->write(credentialKey(instance, mode, settings.email), cleaned, this, [this, settings, serial, done](const CredentialResult &result) {
        if (!result.ok()) {
            done(Outcome{Kind::StoreRefused, m_store ? m_store->message(result) : result.message()});
        } else if (serial != m_serial) {
            // A later call came while the store wrote; its settings win,
            // whichever write ends last.
            qCInfo(lcCredentials) << "A later Configure call replaced this one's settings";
            done(Outcome());
        } else {
            done(apply(settings) ? Outcome() : notWritten());
        }
    });
}

bool ServiceSettings::apply(const ConnectionSettings &settings)
{
    if (!settings.write(*m_settings)) {
        return false;
    }
    settings.applyTo(*m_connection);
    return true;
}

ServiceSettings::Outcome ServiceSettings::notWritten() const
{
    return Outcome{Kind::NotWritten, tr("The settings could not be saved to %1.").arg(m_settings->fileName())};
}

}
