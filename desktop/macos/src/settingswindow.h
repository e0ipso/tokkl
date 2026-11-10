#pragma once

#include "apitypes.h"

#include <QTimer>
#include <QWidget>

#include <array>

class QCheckBox;
class QComboBox;
class QDialogButtonBox;
class QFormLayout;
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
class SettingsSave;
class SoundChoices;
class Transport;

// The secret goes to the credential store, never to QSettings; the stored
// address is ConnectionSetup::persistedUrl(), so no credential reaches the file.
class SettingsWindow : public QWidget
{
    Q_OBJECT

public:
    // Owns only its ConnectionSetup.
    SettingsWindow(Transport *transport,
                   CredentialStore *store,
                   QSettings &settings,
                   LoginItem &loginItem,
                   PomodoroPreferences &preferences,
                   SoundChoices &sounds,
                   PomodoroAlarm &alarm,
                   QWidget *parent = nullptr);
    ~SettingsWindow() override;

    // Call before showing the window; forgets a save still waiting.
    void load();
    // Writes the settings only after the store keeps the secret. Returns
    // false, changing nothing, for an unusable address or a pending save.
    bool save();

Q_SIGNALS:
    void saved();

private:
    void buildConnectionRows(QFormLayout *form);
    void buildLoginRows(QFormLayout *form);
    void buildPomodoroRows(QFormLayout *form);
    void buildSoundRows(QFormLayout *form);
    void nameFields();
    void connectFields(QDialogButtonBox *buttons);

    QString authMode() const;
    void onSaveFinished(bool close);
    void onAccountChanged();
    void updateFields();
    void updateTest();
    void updateLoginItem();
    void onLoginToggled(bool enabled);
    // With keepEdits, edited fields keep their text unless the lengths now
    // belong to another account.
    void loadLengths(bool keepEdits);
    void applyLimits();
    void updatePomodoro();
    void loadSounds();
    void preview(TransitionKind kind);

    QSettings &m_settings;
    LoginItem &m_loginItem;
    ConnectionSetup *m_setup;
    PomodoroPreferences &m_preferences;
    SoundChoices &m_sounds;
    PomodoroAlarm &m_alarm;
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
    QLabel *m_saveError;
    QPushButton *m_testButton;
    QLabel *m_testResult;
    QCheckBox *m_loginToggle;
    QCheckBox *m_monochromeToggle;
    QLabel *m_loginNote;
    QPushButton *m_saveButton;

    std::array<QSpinBox *, 4> m_lengthBoxes;
    // A field whose value differs from this was edited.
    std::array<int, 4> m_lengthsShown{};
    QString m_lengthsOwner;
    std::array<QLabel *, 4> m_lengthErrors;
    QLabel *m_lengthsNote;
    QLabel *m_pomodoroError;
    std::array<QComboBox *, 4> m_soundBoxes;
    QLabel *m_soundError;
    std::array<QPushButton *, 4> m_previewButtons;
};

}
