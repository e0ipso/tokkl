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
// may then close, unless the store refused the secret or the server refused
// a length, whose errors the window shows.
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
    };

    static const QString monochromeIconKey;

    // Uses them all, owning none. Null preferences post no lengths; null
    // settings or sounds store nothing there.
    SettingsSave(ConnectionSetup *setup, QSettings *settings, PomodoroPreferences *preferences, SoundChoices *sounds, QObject *parent = nullptr);

    bool isRunning() const;
    // Starts a save. False, and nothing happens, while one runs.
    bool start(const Values &values);
    // Forgets a save still waiting: what it hears afterwards changes
    // nothing.
    void cancel();

Q_SIGNALS:
    // The settings file holds the new values.
    void stored();
    // The save is over. close is false when the store refused the secret or
    // the server refused a length.
    void finished(bool close);

private:
    enum class Lengths {
        None, // nothing changed, or no account to post to
        Pending,
        Failed,
    };

    void onSecretSaved(quint64 serial, const Values &values, bool saved);
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
};

}
