#include "configurationadapter.h"

#include "servicesettings.h"

namespace Tokkl
{

const QString ConfigurationAdapter::credentialStoreError = QStringLiteral("org.tokkl.Timer1.Error.CredentialStore");
const QString ConfigurationAdapter::supersededError = QStringLiteral("org.tokkl.Timer1.Error.Superseded");

ConfigurationAdapter::ConfigurationAdapter(ServiceSettings *settings, QObject *parent)
    : QObject(parent)
    , m_settings(settings)
{
}

void ConfigurationAdapter::configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret, const Call &call)
{
    if (!m_settings) {
        return;
    }
    m_settings->configure(instanceUrl, authMode, email, secret, [call](const ServiceSettings::Outcome &outcome) {
        QDBusConnection bus = call.bus;
        switch (outcome.kind) {
        case ServiceSettings::Outcome::Kind::Saved:
            bus.send(call.message.createReply());
            break;
        case ServiceSettings::Outcome::Kind::Invalid:
            bus.send(call.message.createErrorReply(QDBusError::InvalidArgs, outcome.message));
            break;
        case ServiceSettings::Outcome::Kind::StoreRefused:
            bus.send(call.message.createErrorReply(credentialStoreError, outcome.message));
            break;
        case ServiceSettings::Outcome::Kind::NotWritten:
            bus.send(call.message.createErrorReply(QDBusError::Failed, outcome.message));
            break;
        case ServiceSettings::Outcome::Kind::Superseded:
            bus.send(call.message.createErrorReply(supersededError, outcome.message));
            break;
        }
    });
}

}
