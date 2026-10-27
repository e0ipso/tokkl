#pragma once

// The Configure page's own access to the account's Pomodoro lengths. Plasma
// runs the Configure dialog in a QML engine of its own, apart from the panel
// item, so the page cannot use the widget's connection. This type gives it
// one, set from the same saved settings and secret, and the preferences
// client on it.

#include "connection.h"
#include "pomodoropreferences.h"

#include <QObject>

namespace Tokkl
{

// Owns a connection and a PomodoroPreferences on it. The page sets the
// connection's instanceUrl, authMode and email from the widget's settings;
// the connection then reads the secret and validates the account, and the
// preferences read the lengths once it is connected.
//
// The lengths are kept in memory only. They are cached per account, and the
// account is known only once the connection has validated it, so this client
// has no cache to show earlier. Until it has read them, the page shows the
// lengths the panel keeps in the widget's settings.
class PomodoroLengthsClient : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences CONSTANT)
    // The connection is reading the secret or validating the account.
    Q_PROPERTY(bool connecting READ isConnecting NOTIFY connectingChanged)

public:
    // Uses the network and KDE Wallet, as the widget's connection does.
    explicit PomodoroLengthsClient(QObject *parent = nullptr);

    Connection *connection() const;
    PomodoroPreferences *preferences() const;
    bool isConnecting() const;

Q_SIGNALS:
    void connectingChanged();

protected:
    // Takes ownership of the connection.
    explicit PomodoroLengthsClient(Connection *connection, QObject *parent = nullptr);

private:
    Connection *m_connection;
    PomodoroPreferences *m_preferences;
    bool m_connecting = false;
};

}
