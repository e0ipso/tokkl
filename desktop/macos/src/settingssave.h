#pragma once

#include "apitypes.h"
#include "connectionsettings.h"

#include <QObject>
#include <QString>

#include <array>

class QSettings;

namespace Tokkl
{

class ConnectionSetup;
class PomodoroPreferences;
class SoundChoices;

// The settings file is written only after the store keeps the secret. A save
// that moves to another account posts no lengths, as they belong to the old one.
class SettingsSave : public QObject
{
    Q_OBJECT

public:
    struct Values {
        ConnectionSettings connection;
        bool monochromeIcon = false;
        // In TransitionKind order.
        std::array<QString, 4> sounds;
        PomodoroConfig lengths;
        // PomodoroPreferences::owner() when the edit started. Empty posts no
        // lengths.
        QString lengthsOwner;
    };

    static const QString monochromeIconKey;

    // Owns none of them.
    SettingsSave(ConnectionSetup *setup, QSettings &settings, PomodoroPreferences &preferences, SoundChoices &sounds, QObject *parent = nullptr);

    bool isRunning() const;
    QString errorString() const;
    bool start(const Values &values);
    void cancel();

Q_SIGNALS:
    void stored();
    void finished(bool close);

private:
    enum class Lengths {
        None, // nothing changed, or no account to post to
        Pending,
        Failed,
    };

    bool lengthsForThisAccount(const Values &values) const;
    void onSecretSaved(quint64 serial, const Values &values, bool saved);
    // On a failure the file and the settings keep what they held.
    bool store(const Values &values);
    void onPreferencesChanged();
    bool lengthsRefused() const;
    void settle();

    ConnectionSetup *m_setup;
    QSettings &m_settings;
    PomodoroPreferences &m_preferences;
    SoundChoices &m_sounds;
    // A store answer for an earlier save is dropped.
    quint64 m_serial = 0;
    bool m_running = false;
    bool m_secretStored = false;
    Lengths m_lengths = Lengths::None;
    QString m_error;
};

}
