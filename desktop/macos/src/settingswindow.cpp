#include "settingswindow.h"

#include "connectionsetup.h"
#include "loginitem.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosounds.h"

#include <QButtonGroup>
#include <QCheckBox>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRadioButton>
#include <QSettings>
#include <QSpinBox>
#include <QVBoxLayout>

namespace Tokkl
{

const QString SettingsWindow::instanceUrlKey = QStringLiteral("instanceUrl");
const QString SettingsWindow::authModeKey = QStringLiteral("authMode");
const QString SettingsWindow::emailKey = QStringLiteral("email");
const QString SettingsWindow::monochromeIconKey = QStringLiteral("monochromeIcon");

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

std::size_t index(PomodoroField field)
{
    return std::size_t(field);
}

std::size_t index(TransitionKind kind)
{
    return std::size_t(kind);
}

PomodoroRange lengthRange(PomodoroField field)
{
    switch (field) {
    case PomodoroField::WorkMinutes:
        return PomodoroConfig::workMinutesRange;
    case PomodoroField::ShortRestMinutes:
        return PomodoroConfig::shortRestMinutesRange;
    case PomodoroField::LongRestMinutes:
        return PomodoroConfig::longRestMinutesRange;
    case PomodoroField::LongRestEvery:
        return PomodoroConfig::longRestEveryRange;
    }
    return {};
}
}

SettingsWindow::SettingsWindow(Transport *transport,
                               CredentialStore *store,
                               QSettings *settings,
                               LoginItem *loginItem,
                               PomodoroPreferences *preferences,
                               PomodoroAlarm *alarm,
                               QWidget *parent)
    : QWidget(parent, Qt::Window)
    , m_settings(settings)
    , m_loginItem(loginItem)
    , m_setup(new ConnectionSetup(transport, store, this))
    , m_preferences(preferences)
    , m_alarm(alarm)
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
    m_monochromeToggle = new QCheckBox(tr("Use a monochrome menu bar icon"));
    m_monochromeToggle->setToolTip(tr("Follows the menu bar's text color automatically."));

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
    form->addRow(QString(), m_monochromeToggle);

    // The Pomodoro section: the account's lengths, then the sound of each
    // transition with a button to hear it.
    auto *pomodoro = new QGroupBox(tr("Pomodoro"));
    auto *pomodoroForm = new QFormLayout(pomodoro);
    const std::array<QString, 4> lengthLabels{tr("Work:"), tr("Short rest:"), tr("Long rest:"), tr("Long rest every:")};
    for (const PomodoroField field : lengthFields) {
        const PomodoroRange range = lengthRange(field);
        auto *box = new QSpinBox;
        box->setRange(range.min, range.max);
        box->setSuffix(field == PomodoroField::LongRestEvery ? tr(" pomodoros") : tr(" min"));
        auto *error = noteLabel();
        error->hide();
        m_lengthBoxes.at(index(field)) = box;
        m_lengthErrors.at(index(field)) = error;
        pomodoroForm->addRow(lengthLabels.at(index(field)), box);
        pomodoroForm->addRow(QString(), error);
    }
    m_lengthsNote = noteLabel();
    m_lengthsNote->setText(tr("These are the lengths last read. Changing them needs a connection to the Tokkl server."));
    pomodoroForm->addRow(QString(), m_lengthsNote);
    m_pomodoroError = noteLabel();
    m_pomodoroError->hide();
    pomodoroForm->addRow(QString(), m_pomodoroError);

    const std::array<QString, 4> soundLabels{tr("Work → short rest:"), tr("Short rest → work:"), tr("Work → long rest:"), tr("Long rest → work:")};
    const QList<PomodoroSound> sounds = pomodoroSounds();
    for (const TransitionKind kind : transitions) {
        auto *box = new QComboBox;
        for (const PomodoroSound &sound : sounds) {
            box->addItem(sound.label, sound.id);
        }
        auto *button = new QPushButton(tr("Preview"));
        button->setToolTip(tr("Plays the selected sound once."));
        auto *row = new QHBoxLayout;
        row->addWidget(box, 1);
        row->addWidget(button);
        m_soundBoxes.at(index(kind)) = box;
        m_previewButtons.at(index(kind)) = button;
        pomodoroForm->addRow(soundLabels.at(index(kind)), row);
        connect(button, &QPushButton::clicked, this, [this, kind] {
            preview(kind);
        });
    }

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Close);
    m_saveButton = buttons->button(QDialogButtonBox::Save);

    auto *layout = new QVBoxLayout(this);
    layout->addLayout(form);
    layout->addWidget(pomodoro);
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

    if (m_preferences) {
        connect(m_preferences, &PomodoroPreferences::changed, this, &SettingsWindow::loadLengths);
        connect(m_preferences, &PomodoroPreferences::stateChanged, this, &SettingsWindow::updatePomodoro);
    }

    connect(buttons, &QDialogButtonBox::accepted, this, &SettingsWindow::save);
    connect(buttons, &QDialogButtonBox::rejected, this, &QWidget::close);

    m_storeError->hide();
    // load() runs when the window opens, so nothing reads the store before.
    updateFields();
    updateLoginItem();
    loadLengths();
    loadSounds();
    updatePomodoro();
}

SettingsWindow::~SettingsWindow() = default;

void SettingsWindow::load()
{
    if (m_settings) {
        m_urlField->setText(m_settings->value(instanceUrlKey).toString());
        const bool password = m_settings->value(authModeKey, tokenMode).toString() == passwordMode;
        (password ? m_passwordButton : m_tokenButton)->setChecked(true);
        m_emailField->setText(m_settings->value(emailKey).toString());
        m_monochromeToggle->setChecked(m_settings->value(monochromeIconKey, false).toBool());
    }
    m_testResult->clear();
    ++m_saveSerial;
    m_saving = false;
    m_secretStored = false;
    m_lengthsSave = LengthsSave::None;
    m_saveButton->setEnabled(true);
    // Drop a secret typed and not saved; the stored one loads below.
    m_setup->editSecret(QString());
    m_secretField->clear();
    onAccountChanged();
    updateLoginItem();
    loadLengths();
    loadSounds();
    if (m_preferences) {
        m_preferences->refresh();
    }
    updatePomodoro();
}

bool SettingsWindow::save()
{
    if (m_saving) {
        return false;
    }
    const QString text = m_urlField->text().trimmed();
    const QString persisted = m_setup->persistedUrl(text);
    if (!text.isEmpty() && persisted.isEmpty()) {
        updateFields();
        return false;
    }
    Fields fields{persisted, authMode(), m_emailField->text().trimmed(), m_monochromeToggle->isChecked(), {}};
    for (const TransitionKind kind : transitions) {
        fields.sounds.at(index(kind)) = m_soundBoxes.at(index(kind))->currentData().toString();
    }
    const quint64 serial = ++m_saveSerial;
    m_saving = true;
    m_secretStored = false;
    m_saveButton->setEnabled(false);
    // The lengths go to the server on their own; the Keychain write below
    // neither waits for them nor depends on them.
    const bool posted = m_preferences
        && m_preferences->save(m_lengthBoxes.at(index(PomodoroField::WorkMinutes))->value(),
                               m_lengthBoxes.at(index(PomodoroField::ShortRestMinutes))->value(),
                               m_lengthBoxes.at(index(PomodoroField::LongRestMinutes))->value(),
                               m_lengthBoxes.at(index(PomodoroField::LongRestEvery))->value());
    m_lengthsSave = posted ? LengthsSave::Pending : LengthsSave::None;
    // A Keychain write can wait for the user to allow access, and it can
    // fail. Nothing else changes, and the window stays, until it is done.
    m_setup->saveSecret(this, [this, serial, fields](bool stored) {
        finishSave(serial, fields, stored);
    });
    return true;
}

void SettingsWindow::finishSave(quint64 serial, const Fields &fields, bool stored)
{
    if (serial != m_saveSerial) {
        return;
    }
    if (!stored) {
        // walletErrorChanged has put the store's error on screen; the
        // secret field keeps what was typed.
        m_saving = false;
        m_saveButton->setEnabled(true);
        return;
    }
    if (m_settings) {
        m_settings->setValue(instanceUrlKey, fields.url);
        m_settings->setValue(authModeKey, fields.authMode);
        m_settings->setValue(emailKey, fields.email);
        m_settings->setValue(monochromeIconKey, fields.monochromeIcon);
        for (const TransitionKind kind : transitions) {
            m_settings->setValue(PomodoroAlarm::soundKey(kind), fields.sounds.at(index(kind)));
        }
        m_settings->sync();
    }
    m_secretStored = true;
    Q_EMIT saved();
    settleSave();
}

void SettingsWindow::settleSave()
{
    if (!m_secretStored || m_lengthsSave == LengthsSave::Pending) {
        return;
    }
    m_saving = false;
    m_saveButton->setEnabled(true);
    if (m_lengthsSave == LengthsSave::Failed) {
        // The errors are next to the fields; the typed values stay.
        return;
    }
    close();
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

void SettingsWindow::loadLengths()
{
    const PomodoroConfig config = m_preferences ? m_preferences->config() : PomodoroConfig{};
    m_lengthBoxes.at(index(PomodoroField::WorkMinutes))->setValue(config.workMinutes);
    m_lengthBoxes.at(index(PomodoroField::ShortRestMinutes))->setValue(config.shortRestMinutes);
    m_lengthBoxes.at(index(PomodoroField::LongRestMinutes))->setValue(config.longRestMinutes);
    m_lengthBoxes.at(index(PomodoroField::LongRestEvery))->setValue(config.longRestEvery);
}

// Shows the preferences' state: whether the lengths can be edited, the
// errors, and the end of a save in flight.
void SettingsWindow::updatePomodoro()
{
    const bool editable = m_preferences && m_preferences->isEditable();
    bool failed = false;
    for (const PomodoroField field : lengthFields) {
        const QString error = m_preferences ? m_preferences->fieldError(field) : QString();
        m_lengthBoxes.at(index(field))->setReadOnly(!editable);
        m_lengthErrors.at(index(field))->setText(error);
        m_lengthErrors.at(index(field))->setVisible(!error.isEmpty());
        failed = failed || !error.isEmpty();
    }
    // Without an account the note says why; a read that failed for lack of
    // one would only repeat it.
    const QString general = editable ? m_preferences->errorString() : QString();
    m_pomodoroError->setText(general);
    m_pomodoroError->setVisible(!general.isEmpty());
    m_lengthsNote->setVisible(!editable);
    failed = failed || !general.isEmpty();

    if (m_lengthsSave == LengthsSave::Pending && !(m_preferences && m_preferences->isSaving())) {
        m_lengthsSave = failed ? LengthsSave::Failed : LengthsSave::None;
        settleSave();
    }
}

void SettingsWindow::loadSounds()
{
    for (const TransitionKind kind : transitions) {
        QComboBox *box = m_soundBoxes.at(index(kind));
        box->setCurrentIndex(box->findData(PomodoroAlarm::chosenSound(m_settings, kind)));
    }
}

void SettingsWindow::preview(TransitionKind kind)
{
    if (m_alarm) {
        m_alarm->preview(m_soundBoxes.at(index(kind))->currentData().toString());
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

QCheckBox *SettingsWindow::monochromeToggle() const
{
    return m_monochromeToggle;
}

QLabel *SettingsWindow::loginNote() const
{
    return m_loginNote;
}

QPushButton *SettingsWindow::saveButton() const
{
    return m_saveButton;
}

QSpinBox *SettingsWindow::lengthBox(PomodoroField field) const
{
    return m_lengthBoxes.at(index(field));
}

QLabel *SettingsWindow::lengthError(PomodoroField field) const
{
    return m_lengthErrors.at(index(field));
}

QLabel *SettingsWindow::lengthsNote() const
{
    return m_lengthsNote;
}

QLabel *SettingsWindow::pomodoroError() const
{
    return m_pomodoroError;
}

QComboBox *SettingsWindow::soundBox(TransitionKind kind) const
{
    return m_soundBoxes.at(index(kind));
}

QPushButton *SettingsWindow::previewButton(TransitionKind kind) const
{
    return m_previewButtons.at(index(kind));
}

}
