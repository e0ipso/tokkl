#pragma once

#include "connectionsettings.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <functional>

class QSettings;

namespace Tokkl
{
class Connection;
class CredentialStore;

// Address, sign-in method and email live in the settings file; the secret
// lives only in the credential store.
class ServiceSettings : public QObject
{
    Q_OBJECT

public:
    struct Outcome {
        enum class Kind {
            Saved,
            Invalid,
            StoreRefused,
            NotWritten,
            Superseded, // a later configure() came while the store wrote; its settings win
        };
        Kind kind = Kind::Saved;
        QString message; // for the user, empty for Saved
    };
    using Done = std::function<void(const Outcome &)>;

    ServiceSettings(QSettings *settings, Connection *connection, CredentialStore *store, QObject *parent = nullptr);

    void load();

    // Saves a nonempty secret first (empty keeps the stored one); on any
    // failure nothing changes. done runs at once or when the store answers.
    void configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret, Done done);

private:
    bool apply(const ConnectionSettings &settings);
    Outcome notWritten() const;

    QPointer<QSettings> m_settings;
    QPointer<Connection> m_connection;
    QPointer<CredentialStore> m_store;
    quint64 m_serial = 0;
};
}
