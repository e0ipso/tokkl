#include "settingssave.h"

#include "connectionsetup.h"
#include "pomodoropreferences.h"
#include "soundchoices.h"

#include <QSettings>

namespace Tokkl
{

namespace
{
constexpr std::array<PomodoroField, 4> lengthFields{
    PomodoroField::WorkMinutes,
    PomodoroField::ShortRestMinutes,
    PomodoroField::LongRestMinutes,
    PomodoroField::LongRestEvery,
};
constexpr std::array<TransitionKind, 4> transitions{
    TransitionKind::WorkToShortRest,
    TransitionKind::ShortRestToWork,
    TransitionKind::WorkToLongRest,
    TransitionKind::LongRestToWork,
};
}

const QString SettingsSave::monochromeIconKey = QStringLiteral("monochromeIcon");

SettingsSave::SettingsSave(ConnectionSetup *setup, QSettings *settings, PomodoroPreferences *preferences, SoundChoices *sounds, QObject *parent)
    : QObject(parent)
    , m_setup(setup)
    , m_settings(settings)
    , m_preferences(preferences)
    , m_sounds(sounds)
{
    if (m_preferences) {
        connect(m_preferences, &PomodoroPreferences::stateChanged, this, &SettingsSave::onPreferencesChanged);
    }
}

bool SettingsSave::isRunning() const
{
    return m_running;
}

bool SettingsSave::start(const Values &values)
{
    if (m_running) {
        return false;
    }
    const quint64 serial = ++m_serial;
    m_running = true;
    m_secretStored = false;
    // The lengths go to the server on their own; the store write below
    // neither waits for them nor depends on them.
    const PomodoroConfig &lengths = values.lengths;
    const bool posted = m_preferences && m_preferences->save(lengths.workMinutes, lengths.shortRestMinutes, lengths.longRestMinutes, lengths.longRestEvery);
    m_lengths = posted ? Lengths::Pending : Lengths::None;
    // A Keychain write can wait for the user to allow access, and it can
    // fail. Nothing else is stored until it is done.
    m_setup->saveSecret(this, [this, serial, values](bool saved) {
        onSecretSaved(serial, values, saved);
    });
    return true;
}

void SettingsSave::cancel()
{
    ++m_serial;
    m_running = false;
    m_secretStored = false;
    m_lengths = Lengths::None;
}

void SettingsSave::onSecretSaved(quint64 serial, const Values &values, bool saved)
{
    if (serial != m_serial) {
        return;
    }
    if (!saved) {
        // The setup's walletError says why; the window keeps what was typed.
        m_running = false;
        Q_EMIT finished(false);
        return;
    }
    if (m_settings) {
        m_settings->setValue(monochromeIconKey, values.monochromeIcon);
        if (m_sounds) {
            for (const TransitionKind kind : transitions) {
                m_settings->setValue(m_sounds->key(kind), values.sounds.at(std::size_t(kind)));
            }
        }
        // Syncs the keys above with its own.
        values.connection.write(*m_settings);
    }
    m_secretStored = true;
    Q_EMIT stored();
    settle();
}

void SettingsSave::onPreferencesChanged()
{
    if (m_lengths == Lengths::Pending && !(m_preferences && m_preferences->isSaving())) {
        m_lengths = lengthsRefused() ? Lengths::Failed : Lengths::None;
        settle();
    }
}

bool SettingsSave::lengthsRefused() const
{
    if (!m_preferences) {
        return false;
    }
    for (const PomodoroField field : lengthFields) {
        if (!m_preferences->fieldError(field).isEmpty()) {
            return true;
        }
    }
    // Without an account the window's note says why; a failure for lack of
    // one does not count.
    return m_preferences->isEditable() && !m_preferences->errorString().isEmpty();
}

void SettingsSave::settle()
{
    if (!m_secretStored || m_lengths == Lengths::Pending) {
        return;
    }
    m_running = false;
    Q_EMIT finished(m_lengths != Lengths::Failed);
}

}
