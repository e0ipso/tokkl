#include "settingswindow.h"

#include "connectionsetup.h"
#include "loginitem.h"

#include <QButtonGroup>
#include <QCheckBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRadioButton>
#include <QSettings>
#include <QVBoxLayout>

namespace Tokkl
{

const QString SettingsWindow::instanceUrlKey = QStringLiteral("instanceUrl");
const QString SettingsWindow::authModeKey = QStringLiteral("authMode");
const QString SettingsWindow::emailKey = QStringLiteral("email");

namespace
{
const QString tokenMode = QStringLiteral("token");
const QString passwordMode = QStringLiteral("password");

QLabel *noteLabel()
{
    auto *label = new QLabel;
    label->setWordWrap(true);
    label->setTextInteractionFlags(Qt::TextSelectableByMouse);
    return label;
}
}

SettingsWindow::SettingsWindow(Transport *transport, CredentialStore *store, QSettings *settings, LoginItem *loginItem, QWidget *parent)
    : QWidget(parent, Qt::Window)
    , m_settings(settings)
    , m_loginItem(loginItem)
    , m_setup(new ConnectionSetup(transport, store, this))
{
    setWindowTitle(tr("Tokkl Settings"));

    m_urlField = new QLineEdit;
    m_urlField->setPlaceholderText(QStringLiteral("https://tokkl.example.com"));
    m_urlField->setInputMethodHints(Qt::ImhUrlCharactersOnly | Qt::ImhNoAutoUppercase);
    m_urlNote = noteLabel();

    m_tokenButton = new QRadioButton(tr("API token"));
    m_passwordButton = new QRadioButton(tr("Email and password"));
    auto *modes = new QButtonGroup(this);
    modes->addButton(m_tokenButton);
    modes->addButton(m_passwordButton);
    m_tokenButton->setChecked(true);
    auto *modeBox = new QVBoxLayout;
    modeBox->addWidget(m_tokenButton);
    modeBox->addWidget(m_passwordButton);

    m_emailLabel = new QLabel(tr("Email:"));
    m_emailField = new QLineEdit;
    m_emailField->setInputMethodHints(Qt::ImhEmailCharactersOnly | Qt::ImhNoAutoUppercase);

    m_secretLabel = new QLabel;
    m_secretField = new QLineEdit;
    m_secretField->setEchoMode(QLineEdit::Password);
    auto *storeNote = noteLabel();
    storeNote->setText(tr("Saved in the macOS Keychain. Tokkl does not store it anywhere else."));
    m_storeError = noteLabel();

    m_testButton = new QPushButton(tr("Test Connection"));
    m_testResult = noteLabel();
    auto *testRow = new QHBoxLayout;
    testRow->addWidget(m_testButton);
    testRow->addWidget(m_testResult, 1);

    m_loginToggle = new QCheckBox(tr("Open Tokkl at login"));
    m_loginNote = noteLabel();

    auto *form = new QFormLayout;
    form->addRow(tr("Instance URL:"), m_urlField);
    form->addRow(QString(), m_urlNote);
    form->addRow(tr("Sign in with:"), modeBox);
    form->addRow(m_emailLabel, m_emailField);
    form->addRow(m_secretLabel, m_secretField);
    form->addRow(QString(), storeNote);
    form->addRow(QString(), m_storeError);
    form->addRow(QString(), testRow);
    form->addRow(QString(), m_loginToggle);
    form->addRow(QString(), m_loginNote);

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Close);
    m_saveButton = buttons->button(QDialogButtonBox::Save);

    auto *layout = new QVBoxLayout(this);
    layout->addLayout(form);
    layout->addWidget(buttons);

    // Load the stored secret for the account on screen once the user stops
    // typing.
    m_loadTimer.setSingleShot(true);
    m_loadTimer.setInterval(400);
    connect(&m_loadTimer, &QTimer::timeout, m_setup, &ConnectionSetup::loadSecret);

    connect(m_urlField, &QLineEdit::textChanged, this, &SettingsWindow::onAccountChanged);
    connect(m_emailField, &QLineEdit::textChanged, this, &SettingsWindow::onAccountChanged);
    connect(m_tokenButton, &QRadioButton::toggled, this, &SettingsWindow::onAccountChanged);
    connect(m_secretField, &QLineEdit::textEdited, m_setup, &ConnectionSetup::editSecret);
    connect(m_secretField, &QLineEdit::textChanged, this, &SettingsWindow::updateTest);

    connect(m_setup, &ConnectionSetup::secretChanged, this, [this] {
        if (m_secretField->text() != m_setup->secret()) {
            m_secretField->setText(m_setup->secret());
        }
    });
    connect(m_setup, &ConnectionSetup::walletErrorChanged, this, [this] {
        m_storeError->setText(m_setup->walletError());
        m_storeError->setVisible(!m_setup->walletError().isEmpty());
    });
    connect(m_setup, &ConnectionSetup::busyChanged, this, &SettingsWindow::updateTest);
    connect(m_setup, &ConnectionSetup::testFinished, this, &SettingsWindow::updateTest);
    connect(m_testButton, &QPushButton::clicked, m_setup, &ConnectionSetup::testAccount);

    connect(m_loginToggle, &QCheckBox::toggled, this, &SettingsWindow::onLoginToggled);

    connect(buttons, &QDialogButtonBox::accepted, this, [this] {
        if (save()) {
            close();
        }
    });
    connect(buttons, &QDialogButtonBox::rejected, this, &QWidget::close);

    m_storeError->hide();
    // load() runs when the window opens, so nothing reads the store before.
    updateFields();
    updateLoginItem();
}

SettingsWindow::~SettingsWindow() = default;

void SettingsWindow::load()
{
    if (m_settings) {
        m_urlField->setText(m_settings->value(instanceUrlKey).toString());
        const bool password = m_settings->value(authModeKey, tokenMode).toString() == passwordMode;
        (password ? m_passwordButton : m_tokenButton)->setChecked(true);
        m_emailField->setText(m_settings->value(emailKey).toString());
    }
    m_testResult->clear();
    // Drop a secret typed and not saved; the stored one loads below.
    m_setup->editSecret(QString());
    m_secretField->clear();
    onAccountChanged();
    updateLoginItem();
}

bool SettingsWindow::save()
{
    const QString text = m_urlField->text().trimmed();
    const QString persisted = m_setup->persistedUrl(text);
    if (!text.isEmpty() && persisted.isEmpty()) {
        updateFields();
        return false;
    }
    if (m_settings) {
        m_settings->setValue(instanceUrlKey, persisted);
        m_settings->setValue(authModeKey, authMode());
        m_settings->setValue(emailKey, m_emailField->text().trimmed());
        m_settings->sync();
    }
    m_setup->saveSecret();
    Q_EMIT saved();
    return true;
}

QString SettingsWindow::authMode() const
{
    return m_passwordButton->isChecked() ? passwordMode : tokenMode;
}

// Keeps the secret field tied to the account on screen: a secret loaded for
// one account is cleared when the window moves to another.
void SettingsWindow::onAccountChanged()
{
    m_setup->setAccount(m_urlField->text(), authMode(), m_emailField->text());
    m_loadTimer.start();
    updateFields();
}

void SettingsWindow::updateFields()
{
    const bool password = m_passwordButton->isChecked();
    m_emailLabel->setVisible(password);
    m_emailField->setVisible(password);
    m_secretLabel->setText(password ? tr("Password:") : tr("API token:"));
    m_secretField->setPlaceholderText(password ? QString() : tr("From Settings → API token in Tokkl"));

    const QString url = m_urlField->text();
    const QString error = url.trimmed().isEmpty() ? QString() : m_setup->urlError(url);
    if (!error.isEmpty()) {
        m_urlNote->setText(error);
    } else if (m_setup->isInsecure(url)) {
        m_urlNote->setText(tr("This address uses plain http. Your token or password would be sent unencrypted."));
    } else {
        m_urlNote->clear();
    }
    m_urlNote->setVisible(!m_urlNote->text().isEmpty());
    updateTest();
}

void SettingsWindow::updateTest()
{
    const QString url = m_urlField->text();
    m_testButton->setEnabled(!m_setup->isBusy() && !url.trimmed().isEmpty() && m_setup->urlError(url).isEmpty() && !m_setup->secret().isEmpty());
    switch (m_setup->testResult()) {
    case ConnectionSetup::NotTested:
        break;
    case ConnectionSetup::Testing:
        m_testResult->setText(tr("Testing…"));
        break;
    case ConnectionSetup::Succeeded:
    case ConnectionSetup::Failed:
        m_testResult->setText(m_setup->testMessage());
        break;
    }
}

void SettingsWindow::updateLoginItem()
{
    const LoginItem::State state = m_loginItem ? m_loginItem->state() : LoginItem::State::Unavailable;
    m_loginToggle->setVisible(m_loginItem != nullptr);
    m_loginToggle->setEnabled(state != LoginItem::State::Unavailable);
    {
        const QSignalBlocker blocker(m_loginToggle);
        m_loginToggle->setChecked(state == LoginItem::State::Enabled || state == LoginItem::State::RequiresApproval);
    }
    switch (state) {
    case LoginItem::State::RequiresApproval:
        m_loginNote->setText(tr("Allow Tokkl in System Settings → General → Login Items to open it at login."));
        break;
    case LoginItem::State::Unavailable:
        m_loginNote->setText(m_loginItem ? tr("This copy of Tokkl cannot open at login. Move it to the Applications folder.") : QString());
        break;
    case LoginItem::State::Disabled:
    case LoginItem::State::Enabled:
        m_loginNote->clear();
        break;
    }
    m_loginNote->setVisible(!m_loginNote->text().isEmpty());
}

void SettingsWindow::onLoginToggled(bool enabled)
{
    if (!m_loginItem) {
        return;
    }
    const QString error = m_loginItem->setEnabled(enabled);
    updateLoginItem();
    if (!error.isEmpty()) {
        m_loginNote->setText(error);
        m_loginNote->setVisible(true);
    }
}

ConnectionSetup *SettingsWindow::setup() const
{
    return m_setup;
}

QLineEdit *SettingsWindow::urlField() const
{
    return m_urlField;
}

QRadioButton *SettingsWindow::tokenButton() const
{
    return m_tokenButton;
}

QRadioButton *SettingsWindow::passwordButton() const
{
    return m_passwordButton;
}

QLineEdit *SettingsWindow::emailField() const
{
    return m_emailField;
}

QLineEdit *SettingsWindow::secretField() const
{
    return m_secretField;
}

QLabel *SettingsWindow::urlNote() const
{
    return m_urlNote;
}

QLabel *SettingsWindow::storeError() const
{
    return m_storeError;
}

QPushButton *SettingsWindow::testButton() const
{
    return m_testButton;
}

QLabel *SettingsWindow::testResult() const
{
    return m_testResult;
}

QCheckBox *SettingsWindow::loginToggle() const
{
    return m_loginToggle;
}

QLabel *SettingsWindow::loginNote() const
{
    return m_loginNote;
}

QPushButton *SettingsWindow::saveButton() const
{
    return m_saveButton;
}

}
