#include "settingswindow.h"

#include "connectionsettings.h"
#include "connectionsetup.h"
#include "loginitem.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosounds.h"
#include "settingssave.h"
#include "soundchoices.h"

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

// Long rest every: a count of pomodoros, shown with a plural that follows
// the count. The text is a numerus message, so a catalog can give each
// language its own forms. With no catalog loaded Qt shows a source text as
// written, so the English source keeps the singular apart from the plural.
class PomodoroCountBox : public QSpinBox
{
public:
    using QSpinBox::QSpinBox;

protected:
    QString textFromValue(int value) const override
    {
        return value == 1 ? SettingsWindow::tr("%n pomodoro", nullptr, value) : SettingsWindow::tr("%n pomodoros", nullptr, value);
    }

    int valueFromText(const QString &text) const override
    {
        return digits(text).toInt();
    }

    // The count is the digits typed; the words around them come back with
    // the value.
    QValidator::State validate(QString &input, int &) const override
    {
        const QString typed = digits(input);
        bool ok = false;
        const int value = typed.toInt(&ok);
        if (typed.isEmpty()) {
            return QValidator::Intermediate;
        }
        if (!ok) {
            return QValidator::Invalid;
        }
        return value >= minimum() && value <= maximum() ? QValidator::Acceptable : QValidator::Intermediate;
    }

private:
    static QString digits(const QString &text)
    {
        QString digits;
        for (const QChar c : text) {
            if (c.isDigit()) {
                digits += c;
            }
        }
        return digits;
    }
};

std::size_t index(PomodoroField field)
{
    return std::size_t(field);
}

std::size_t index(TransitionKind kind)
{
    return std::size_t(kind);
}

int lengthOf(const PomodoroConfig &config, PomodoroField field)
{
    switch (field) {
    case PomodoroField::WorkMinutes:
        return config.workMinutes;
    case PomodoroField::ShortRestMinutes:
        return config.shortRestMinutes;
    case PomodoroField::LongRestMinutes:
        return config.longRestMinutes;
    case PomodoroField::LongRestEvery:
        return config.longRestEvery;
    }
    return 0;
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
                               SoundChoices *soundChoices,
                               PomodoroAlarm *alarm,
                               QWidget *parent)
    : QWidget(parent, Qt::Window)
    , m_settings(settings)
    , m_loginItem(loginItem)
    , m_setup(new ConnectionSetup(transport, store, this))
    , m_preferences(preferences)
    , m_sounds(soundChoices)
    , m_alarm(alarm)
    , m_save(new SettingsSave(m_setup, settings, preferences, soundChoices, this))
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
        QSpinBox *box = field == PomodoroField::LongRestEvery ? new PomodoroCountBox : new QSpinBox;
        box->setRange(range.min, range.max);
        if (field != PomodoroField::LongRestEvery) {
            box->setSuffix(tr(" min"));
        }
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
    // Each selector and Preview button names its transition in words, as
    // a screen reader would read the arrow of the visible label.
    const std::array<QString, 4> soundNames{tr("Work to short rest sound"), tr("Short rest to work sound"), tr("Work to long rest sound"),
                                            tr("Long rest to work sound")};
    const std::array<QString, 4> previewNames{tr("Preview the work to short rest sound"), tr("Preview the short rest to work sound"),
                                              tr("Preview the work to long rest sound"), tr("Preview the long rest to work sound")};
    const QList<PomodoroSound> sounds = pomodoroSounds();
    for (const TransitionKind kind : transitions) {
        auto *box = new QComboBox;
        for (const PomodoroSound &sound : sounds) {
            box->addItem(sound.label, sound.id);
        }
        box->setAccessibleName(soundNames.at(index(kind)));
        auto *button = new QPushButton(tr("Preview"));
        button->setToolTip(tr("Plays the selected sound once."));
        button->setAccessibleName(previewNames.at(index(kind)));
        auto *row = new QHBoxLayout;
        row->addWidget(box, 1);
        row->addWidget(button);
        m_soundBoxes.at(index(kind)) = box;
        m_previewButtons.at(index(kind)) = button;
        // The row is a layout, which takes no buddy, so the label is made
        // here and points at the selector.
        auto *label = new QLabel(soundLabels.at(index(kind)));
        label->setBuddy(box);
        pomodoroForm->addRow(label, row);
        connect(button, &QPushButton::clicked, this, [this, kind] {
            preview(kind);
        });
    }
    m_soundError = noteLabel();
    m_soundError->hide();
    pomodoroForm->addRow(QString(), m_soundError);
    if (m_alarm) {
        const auto showFailure = [this] {
            const QString failure = m_alarm ? m_alarm->failure() : QString();
            m_soundError->setText(failure);
            m_soundError->setVisible(!failure.isEmpty());
        };
        connect(m_alarm, &PomodoroAlarm::failureChanged, this, showFailure);
        showFailure();
    }

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Close);
    m_saveButton = buttons->button(QDialogButtonBox::Save);
    m_saveError = noteLabel();
    m_saveError->hide();

    auto *layout = new QVBoxLayout(this);
    layout->addLayout(form);
    layout->addWidget(pomodoro);
    layout->addWidget(m_saveError);
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
        connect(m_preferences, &PomodoroPreferences::changed, this, [this] {
            loadLengths(true);
        });
        connect(m_preferences, &PomodoroPreferences::stateChanged, this, &SettingsWindow::updatePomodoro);
    }

    connect(m_save, &SettingsSave::stored, this, &SettingsWindow::saved);
    connect(m_save, &SettingsSave::finished, this, &SettingsWindow::onSaveFinished);
    connect(buttons, &QDialogButtonBox::accepted, this, &SettingsWindow::save);
    connect(buttons, &QDialogButtonBox::rejected, this, &QWidget::close);

    m_storeError->hide();
    // load() runs when the window opens, so nothing reads the store before.
    updateFields();
    updateLoginItem();
    loadLengths(false);
    loadSounds();
    updatePomodoro();
}

SettingsWindow::~SettingsWindow() = default;

void SettingsWindow::load()
{
    if (m_settings) {
        const ConnectionSettings connection = ConnectionSettings::read(*m_settings);
        m_urlField->setText(connection.instanceUrl);
        (connection.authMode == passwordMode ? m_passwordButton : m_tokenButton)->setChecked(true);
        m_emailField->setText(connection.email);
        m_monochromeToggle->setChecked(m_settings->value(SettingsSave::monochromeIconKey, false).toBool());
    }
    m_testResult->clear();
    m_save->cancel();
    m_saveButton->setEnabled(true);
    m_saveError->hide();
    // Drop a secret typed and not saved; the stored one loads below.
    m_setup->editSecret(QString());
    m_secretField->clear();
    onAccountChanged();
    updateLoginItem();
    loadLengths(false);
    loadSounds();
    if (m_preferences) {
        m_preferences->refresh();
    }
    updatePomodoro();
}

bool SettingsWindow::save()
{
    if (m_save->isRunning()) {
        return false;
    }
    const QString text = m_urlField->text().trimmed();
    const QString persisted = m_setup->persistedUrl(text);
    if (!text.isEmpty() && persisted.isEmpty()) {
        updateFields();
        return false;
    }
    SettingsSave::Values values;
    values.connection = ConnectionSettings{persisted, authMode(), m_emailField->text().trimmed()};
    values.monochromeIcon = m_monochromeToggle->isChecked();
    for (const TransitionKind kind : transitions) {
        values.sounds.at(index(kind)) = m_soundBoxes.at(index(kind))->currentData().toString();
    }
    values.lengths.workMinutes = m_lengthBoxes.at(index(PomodoroField::WorkMinutes))->value();
    values.lengths.shortRestMinutes = m_lengthBoxes.at(index(PomodoroField::ShortRestMinutes))->value();
    values.lengths.longRestMinutes = m_lengthBoxes.at(index(PomodoroField::LongRestMinutes))->value();
    values.lengths.longRestEvery = m_lengthBoxes.at(index(PomodoroField::LongRestEvery))->value();
    values.lengthsOwner = m_lengthsOwner;
    // Disabled before the save starts, which may finish at once.
    m_saveButton->setEnabled(false);
    m_saveError->hide();
    return m_save->start(values);
}

void SettingsWindow::onSaveFinished(bool close)
{
    m_saveButton->setEnabled(true);
    m_saveError->setText(m_save->errorString());
    m_saveError->setVisible(!m_save->errorString().isEmpty());
    if (close) {
        QWidget::close();
    }
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

void SettingsWindow::loadLengths(bool keepEdits)
{
    const PomodoroConfig config = m_preferences ? m_preferences->config() : PomodoroConfig{};
    const QString owner = m_preferences ? m_preferences->owner() : QString();
    // An edit is meant for the account it was made on.
    keepEdits = keepEdits && owner == m_lengthsOwner;
    m_lengthsOwner = owner;
    for (const PomodoroField field : lengthFields) {
        QSpinBox *box = m_lengthBoxes.at(index(field));
        int &shown = m_lengthsShown.at(index(field));
        const bool edited = keepEdits && box->value() != shown;
        shown = lengthOf(config, field);
        if (!edited) {
            box->setValue(shown);
        }
    }
}

// Shows the preferences' state: whether the lengths can be edited, the
// errors, and the end of a save in flight.
void SettingsWindow::updatePomodoro()
{
    // Another account whose lengths equal the ones shown announces no new
    // lengths, but the edits still belonged to the one before.
    if (m_preferences && m_preferences->owner() != m_lengthsOwner) {
        loadLengths(true);
    }
    const bool editable = m_preferences && m_preferences->isEditable();
    for (const PomodoroField field : lengthFields) {
        const QString error = m_preferences ? m_preferences->fieldError(field) : QString();
        m_lengthBoxes.at(index(field))->setReadOnly(!editable);
        m_lengthErrors.at(index(field))->setText(error);
        m_lengthErrors.at(index(field))->setVisible(!error.isEmpty());
    }
    // Without an account the note says why; a read that failed for lack of
    // one would only repeat it.
    const QString general = editable ? m_preferences->errorString() : QString();
    m_pomodoroError->setText(general);
    m_pomodoroError->setVisible(!general.isEmpty());
    m_lengthsNote->setVisible(!editable);
}

void SettingsWindow::loadSounds()
{
    for (const TransitionKind kind : transitions) {
        QComboBox *box = m_soundBoxes.at(index(kind));
        box->setCurrentIndex(box->findData(m_sounds ? m_sounds->chosen(kind) : defaultSound(kind)));
    }
}

void SettingsWindow::preview(TransitionKind kind)
{
    if (m_alarm) {
        m_alarm->preview(m_soundBoxes.at(index(kind))->currentData().toString());
    }
}

}
