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

namespace Tokkl
{

class ConnectionSetup;
class CredentialStore;
class LoginItem;
class PomodoroAlarm;
class PomodoroPreferences;
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
// Save posts the lengths that changed next to the Keychain write, without
// waiting for it, and keeps the sound choices with the other settings. The
// window closes once the store has the secret and the server has the
// lengths; a length the server refuses shows next to its field, and the
// window stays open.
class SettingsWindow : public QWidget
{
    Q_OBJECT

public:
    static const QString instanceUrlKey;
    static const QString authModeKey;
    static const QString emailKey;
    static const QString monochromeIconKey;

    // Uses the given transport, store, settings, login item, preferences
    // and alarm; the window owns none of them. loginItem may be null: the
    // toggle is hidden. With null preferences the lengths cannot be edited;
    // with a null alarm Preview plays nothing.
    SettingsWindow(Transport *transport,
                   CredentialStore *store,
                   QSettings *settings,
                   LoginItem *loginItem,
                   PomodoroPreferences *preferences,
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
    // and shows the store's error; when the server refuses a length, it
    // stays open with the error next to the field. Returns false, and
    // changes nothing, when the address is not usable or a save is already
    // waiting.
    bool save();

    ConnectionSetup *setup() const;
    QLineEdit *urlField() const;
    QRadioButton *tokenButton() const;
    QRadioButton *passwordButton() const;
    QLineEdit *emailField() const;
    QLineEdit *secretField() const;
    QLabel *urlNote() const;
    QLabel *storeError() const;
    QPushButton *testButton() const;
    QLabel *testResult() const;
    QCheckBox *loginToggle() const;
    QCheckBox *monochromeToggle() const;
    QLabel *loginNote() const;
    QPushButton *saveButton() const;

    QSpinBox *lengthBox(PomodoroField field) const;
    // The server's message for the field's refused value.
    QLabel *lengthError(PomodoroField field) const;
    // Why the lengths cannot be edited.
    QLabel *lengthsNote() const;
    // A failed read, or a refused save that names no field.
    QLabel *pomodoroError() const;
    QComboBox *soundBox(TransitionKind kind) const;
    QPushButton *previewButton(TransitionKind kind) const;

Q_SIGNALS:
    // The settings were saved.
    void saved();

private:
    struct Fields {
        QString url;
        QString authMode;
        QString email;
        bool monochromeIcon;
        // The sound id chosen per transition, in TransitionKind order.
        std::array<QString, 4> sounds;
    };

    // The lengths' part of a save.
    enum class LengthsSave {
        None, // nothing changed, or no account to post to
        Pending,
        Failed,
    };

    QString authMode() const;
    void finishSave(quint64 serial, const Fields &fields, bool stored);
    // Closes once the store has the secret and the lengths are done.
    void settleSave();
    void onAccountChanged();
    void updateFields();
    void updateTest();
    void updateLoginItem();
    void onLoginToggled(bool enabled);
    void loadLengths();
    void updatePomodoro();
    void loadSounds();
    void preview(TransitionKind kind);

    QPointer<QSettings> m_settings;
    LoginItem *m_loginItem;
    ConnectionSetup *m_setup;
    QPointer<PomodoroPreferences> m_preferences;
    QPointer<PomodoroAlarm> m_alarm;
    QTimer m_loadTimer;
    // Counts saves; a store result for an earlier one is dropped.
    quint64 m_saveSerial = 0;
    bool m_saving = false;
    bool m_secretStored = false;
    LengthsSave m_lengthsSave = LengthsSave::None;

    QLineEdit *m_urlField;
    QLabel *m_urlNote;
    QRadioButton *m_tokenButton;
    QRadioButton *m_passwordButton;
    QLabel *m_emailLabel;
    QLineEdit *m_emailField;
    QLabel *m_secretLabel;
    QLineEdit *m_secretField;
    QLabel *m_storeError;
    QPushButton *m_testButton;
    QLabel *m_testResult;
    QCheckBox *m_loginToggle;
    QCheckBox *m_monochromeToggle;
    QLabel *m_loginNote;
    QPushButton *m_saveButton;

    std::array<QSpinBox *, 4> m_lengthBoxes;
    std::array<QLabel *, 4> m_lengthErrors;
    QLabel *m_lengthsNote;
    QLabel *m_pomodoroError;
    std::array<QComboBox *, 4> m_soundBoxes;
    std::array<QPushButton *, 4> m_previewButtons;
};

}
