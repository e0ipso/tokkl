#pragma once

#include "apitypes.h"
#include "connectionsettings.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <array>

class QSettings;

namespace Tokkl
{

class ConnectionSetup;
class PomodoroPreferences;
class SoundChoices;

// One Save of the Settings window, apart from its widgets. The lengths that
// changed go to the server and the secret to the credential store at the
// same time. Only once the store has kept the secret do the other values go
// to the settings file. The save is finished when both are done; the window
// may then close, unless the store refused the secret, the settings file
// could not be written, or the server refused a length, whose errors the
// window shows.
//
// The lengths belong to the account they were edited for. They are posted
// only while the connection serves that account and the save keeps the
// connection's instance and sign-in; a save that moves to another account
// posts none, as they would change the account it leaves.
class SettingsSave : public QObject
{
    Q_OBJECT

public:
    struct Values {
        ConnectionSettings connection;
        bool monochromeIcon = false;
        // The sound id chosen per transition, in TransitionKind order.
        std::array<QString, 4> sounds;
        PomodoroConfig lengths;
        // PomodoroPreferences::owner() of the lengths the edit started
        // from. Empty posts no lengths.
        QString lengthsOwner;
    };

    static const QString monochromeIconKey;

    // Uses them all, owning none. Null preferences post no lengths; null
    // settings or sounds store nothing there.
    SettingsSave(ConnectionSetup *setup, QSettings *settings, PomodoroPreferences *preferences, SoundChoices *sounds, QObject *parent = nullptr);

    bool isRunning() const;
    // Why the last save could not write the settings file; empty when it
    // could, and while a save runs.
    QString errorString() const;
    // Starts a save. False, and nothing happens, while one runs.
    bool start(const Values &values);
    // Forgets a save still waiting: what it hears afterwards changes
    // nothing.
    void cancel();

Q_SIGNALS:
    // The settings file holds the new values.
    void stored();
    // The save is over. close is false when the store refused the secret,
    // the settings file could not be written or the server refused a
    // length.
    void finished(bool close);

private:
    enum class Lengths {
        None, // nothing changed, or no account to post to
        Pending,
        Failed,
    };

    // The lengths may go to the account they were edited for.
    bool lengthsForThisAccount(const Values &values) const;
    void onSecretSaved(quint64 serial, const Values &values, bool saved);
    // Writes the values to the settings file. On a failure the file and the
    // settings keep what they held.
    bool store(const Values &values);
    void onPreferencesChanged();
    bool lengthsRefused() const;
    void settle();

    ConnectionSetup *m_setup;
    QPointer<QSettings> m_settings;
    QPointer<PomodoroPreferences> m_preferences;
    QPointer<SoundChoices> m_sounds;
    // Counts saves; a store answer for an earlier one is dropped.
    quint64 m_serial = 0;
    bool m_running = false;
    bool m_secretStored = false;
    Lengths m_lengths = Lengths::None;
    QString m_error;
};

}
