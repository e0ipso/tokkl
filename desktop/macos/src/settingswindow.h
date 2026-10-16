#pragma once

#include <QPointer>
#include <QTimer>
#include <QWidget>

class QCheckBox;
class QLabel;
class QLineEdit;
class QPushButton;
class QRadioButton;
class QSettings;

namespace Tokkl
{

class ConnectionSetup;
class CredentialStore;
class LoginItem;
class Transport;

// Connection settings and the login item. The address, sign-in method and
// email go to QSettings; the API token or password goes to the credential
// store through ConnectionSetup and never to the settings. Save keeps them;
// closing without saving drops what was typed.
//
// The address kept is ConnectionSetup::persistedUrl() of the field: the
// normalized address with its path prefix, never user info, a query or a
// fragment, so no credential reaches the settings file.
//
// The login item toggle applies at once, apart from Save.
class SettingsWindow : public QWidget
{
    Q_OBJECT

public:
    static const QString instanceUrlKey;
    static const QString authModeKey;
    static const QString emailKey;

    // Uses the given transport, store, settings and login item; the window
    // owns none of them. loginItem may be null: the toggle is hidden.
    SettingsWindow(Transport *transport, CredentialStore *store, QSettings *settings, LoginItem *loginItem, QWidget *parent = nullptr);
    ~SettingsWindow() override;

    // Fills the fields from the settings and the stored secret. Call it
    // before showing the window.
    void load();
    // Keeps the fields. Returns false, and changes nothing, when the address
    // is not usable.
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
    QLabel *loginNote() const;
    QPushButton *saveButton() const;

Q_SIGNALS:
    // The settings were saved.
    void saved();

private:
    QString authMode() const;
    void onAccountChanged();
    void updateFields();
    void updateTest();
    void updateLoginItem();
    void onLoginToggled(bool enabled);

    QPointer<QSettings> m_settings;
    LoginItem *m_loginItem;
    ConnectionSetup *m_setup;
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
    QPushButton *m_testButton;
    QLabel *m_testResult;
    QCheckBox *m_loginToggle;
    QLabel *m_loginNote;
    QPushButton *m_saveButton;
};

}
