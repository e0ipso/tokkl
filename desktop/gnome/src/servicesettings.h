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

// The connection settings of tokkl-timerd: the address, sign-in method and
// email in its settings file, given to the connection at start and on each
// Configure, and the secret in the credential store only. The D-Bus side
// lives in TimerService; this class knows nothing of the bus.
class ServiceSettings : public QObject
{
    Q_OBJECT

public:
    struct Outcome {
        enum class Kind {
            Saved,
            Invalid, // the address, sign-in method or email cannot be used
            StoreRefused, // the credential store did not keep the secret
            NotWritten, // the settings file could not be written
            Superseded, // a later configure() came while the store wrote; its settings win
        };
        Kind kind = Kind::Saved;
        QString message; // for the user, empty for Saved
    };
    using Done = std::function<void(const Outcome &)>;

    // None of the three is owned.
    ServiceSettings(QSettings *settings, Connection *connection, CredentialStore *store, QObject *parent = nullptr);

    // Gives the connection the settings in the file, when it names an
    // instance.
    void load();

    // Saves a nonempty secret in the store first, then the settings, and
    // gives them to the connection. An empty secret keeps the one the store
    // holds for that account. Nothing changes when the call is invalid, the
    // store refuses the secret or the file cannot be written; when a later
    // call comes while the store writes, the later settings win and this
    // call ends Superseded, its settings never applied. done runs
    // at once for an invalid call or an empty secret, otherwise once the
    // store answers.
    void configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret, Done done);

private:
    // Writes the settings and gives them to the connection. False, and
    // nothing changes, when the file cannot be written.
    bool apply(const ConnectionSettings &settings);
    Outcome notWritten() const;

    QPointer<QSettings> m_settings;
    QPointer<Connection> m_connection;
    QPointer<CredentialStore> m_store;
    // Counts configure() calls. A store write that answers after a later
    // call leaves that call's settings in place.
    quint64 m_serial = 0;
};
}
