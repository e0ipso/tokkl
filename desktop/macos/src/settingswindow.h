#pragma once

#include "apitypes.h"

#include <QPointer>
#include <QTimer>
#include <QWidget>

#include <array>

class QCheckBox;
class QComboBox;
class QLabel;
class QLineEdit;
class QPushButton;
class QRadioButton;
class QSettings;
class QSpinBox;
class MenuBarAppTest;

namespace Tokkl
{

class ConnectionSetup;
class CredentialStore;
class LoginItem;
class PomodoroAlarm;
class PomodoroPreferences;
class SettingsSave;
class SoundChoices;
class Transport;

// Connection settings, the login item and the Pomodoro section. The
// address, sign-in method and email go to QSettings; the API token or
// password goes to the credential store through ConnectionSetup and never
// to the settings. Save keeps them once the store has kept the secret;
// closing without saving drops what was typed.
//
// The address kept is ConnectionSetup::persistedUrl() of the field: the
// normalized address with its path prefix, never user info, a query or a
// fragment, so no credential reaches the settings file.
//
// The login item toggle applies at once, apart from Save.
//
// The Pomodoro section shows the account's four lengths from
// PomodoroPreferences, read again when the window opens, and the sound of
// each transition from the catalogue. The lengths can be edited only with a
// validated account; otherwise the last ones read show, and a note says so.
// Lengths read while the window is open fill only the fields the user has
// not changed, and lengths of another account replace every field. Save
// posts the lengths that changed next to the Keychain write, without
// waiting for it, and only to the account they were edited for, so a save
// that also moves to another account posts none (see SettingsSave). It
// keeps the sound choices with the other settings. The window closes once
// the store has the secret, the settings file has the rest and the server
// has the lengths; a length the server refuses shows next to its field, a
// settings file that cannot be written shows below the form, and the
// window stays open.
class SettingsWindow : public QWidget
{
    Q_OBJECT

public:
    // Uses the given transport, store, settings, login item, preferences,
    // sound choices and alarm; the window owns none of them. loginItem may
    // be null: the toggle is hidden. With null preferences the lengths
    // cannot be edited; with a null alarm Preview plays nothing.
    SettingsWindow(Transport *transport,
                   CredentialStore *store,
                   QSettings *settings,
                   LoginItem *loginItem,
                   PomodoroPreferences *preferences,
                   SoundChoices *sounds,
                   PomodoroAlarm *alarm,
                   QWidget *parent = nullptr);
    ~SettingsWindow() override;

    // Fills the fields from the settings and the stored secret, reads the
    // lengths again, and forgets a save still waiting. Call it before
    // showing the window.
    void load();
    // Saves the secret in the store and, once the store has kept it, the
    // other fields in the settings; then emits saved(). Posts the lengths
    // that changed at the same time. Closes the window once both are done.
    // When the store fails, the window stays open with the fields as typed
    // and shows the store's error; when the settings file cannot be
    // written, it stays open and says so; when the server refuses a
    // length, it stays open with the error next to the field. Returns
    // false, and changes nothing, when the address is not usable or a save
    // is already waiting.
    bool save();

Q_SIGNALS:
    // The settings were saved.
    void saved();

private:
    // The app's tests fill and read the fields.
    friend class ::MenuBarAppTest;

    QString authMode() const;
    void onSaveFinished(bool close);
    void onAccountChanged();
    void updateFields();
    void updateTest();
    void updateLoginItem();
    void onLoginToggled(bool enabled);
    // Shows the preferences' lengths. With keepEdits, a field changed since
    // it was last filled keeps what was typed, unless the lengths now
    // belong to another account.
    void loadLengths(bool keepEdits);
    void updatePomodoro();
    void loadSounds();
    void preview(TransitionKind kind);

    QPointer<QSettings> m_settings;
    LoginItem *m_loginItem;
    ConnectionSetup *m_setup;
    QPointer<PomodoroPreferences> m_preferences;
    QPointer<SoundChoices> m_sounds;
    QPointer<PomodoroAlarm> m_alarm;
    SettingsSave *m_save;
    QTimer m_loadTimer;

    QLineEdit *m_urlField;
    QLabel *m_urlNote;
    QRadioButton *m_tokenButton;
    QRadioButton *m_passwordButton;
    QLabel *m_emailLabel;
    QLineEdit *m_emailField;
    QLabel *m_secretLabel;
    QLineEdit *m_secretField;
    QLabel *m_storeError;
    // A settings file the last save could not write.
    QLabel *m_saveError;
    QPushButton *m_testButton;
    QLabel *m_testResult;
    QCheckBox *m_loginToggle;
    QCheckBox *m_monochromeToggle;
    QLabel *m_loginNote;
    QPushButton *m_saveButton;

    std::array<QSpinBox *, 4> m_lengthBoxes;
    // What each length field was last filled with, and the account it
    // belonged to: a field whose value differs was edited.
    std::array<int, 4> m_lengthsShown{};
    QString m_lengthsOwner;
    // The server's message for each field's refused value.
    std::array<QLabel *, 4> m_lengthErrors;
    // Why the lengths cannot be edited.
    QLabel *m_lengthsNote;
    // A failed read, or a refused save that names no field.
    QLabel *m_pomodoroError;
    std::array<QComboBox *, 4> m_soundBoxes;
    std::array<QPushButton *, 4> m_previewButtons;
};

}
