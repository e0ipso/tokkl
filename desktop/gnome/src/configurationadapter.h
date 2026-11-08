#pragma once

#include <QDBusConnection>
#include <QDBusMessage>
#include <QObject>
#include <QPointer>
#include <QString>

#include <optional>

namespace Tokkl
{

class ServiceSettings;

// The Configure method of org.tokkl.Timer1. It hands the arguments to
// ServiceSettings and answers the call once the outcome is known, which may
// be after the credential store has written the secret: an empty reply when
// the settings were saved, InvalidArgs for settings that cannot be used,
// credentialStoreError when the store refused the secret, supersededError
// when a later Configure call came while the store wrote, so these settings
// were never applied, and Failed when the settings file could not be
// written. Each error carries the message for the user.
class ConfigurationAdapter : public QObject
{
    Q_OBJECT

public:
    // The error of a Configure call whose secret the credential store refused.
    static const QString credentialStoreError;
    // The error of a Configure call that a later one replaced before its
    // settings were applied.
    static const QString supersededError;

    // A Configure call that waits for its answer.
    struct Call {
        QDBusMessage message;
        QDBusConnection bus;
    };

    // The settings are not owned.
    explicit ConfigurationAdapter(ServiceSettings *settings, QObject *parent = nullptr);

    // Saves the settings and answers call, when there is one, with the
    // outcome. Without a call, as when the method is run directly, nothing is
    // answered.
    void configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret, const std::optional<Call> &call);

private:
    QPointer<ServiceSettings> m_settings;
};

}
