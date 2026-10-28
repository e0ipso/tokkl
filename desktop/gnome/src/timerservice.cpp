#include "timerservice.h"

#include "timer1adaptor.h"

#include "clock.h"
#include "connection.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "apitypes.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <QDBusMessage>
#include <QDBusMetaType>
#include <QMetaMethod>
#include <QSettings>

#include <optional>

namespace Tokkl
{

const QString TimerService::serviceName = QStringLiteral("org.tokkl.Timer1");
const QString TimerService::objectPath = QStringLiteral("/org/tokkl/Timer1");
const QString TimerService::interfaceName = QStringLiteral("org.tokkl.Timer1");
const QString TimerService::credentialStoreError = QStringLiteral("org.tokkl.Timer1.Error.CredentialStore");

namespace
{
const QString instanceUrlKey = QStringLiteral("instanceUrl");
const QString authModeKey = QStringLiteral("authMode");
const QString emailKey = QStringLiteral("email");
// The sound choices, keyed by transition name.
const QString soundsGroup = QStringLiteral("Sounds");
// The key of a failed read, or of a refusal that names no length, in
// PomodoroLengthErrors.
const QString generalErrorKey = QStringLiteral("general");

constexpr TransitionKind transitions[] = {
    TransitionKind::WorkToShortRest,
    TransitionKind::ShortRestToWork,
    TransitionKind::WorkToLongRest,
    TransitionKind::LongRestToWork,
};

qint64 unixSeconds(const QDateTime &time)
{
    return time.isValid() ? time.toSecsSinceEpoch() : 0;
}

QString soundKey(TransitionKind kind)
{
    return soundsGroup + QLatin1Char('/') + transitionKindName(kind);
}
}

QString TimerService::clientName()
{
    return QStringLiteral("tokkl-gnome");
}

TimerService::TimerService(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock, QObject *parent)
    : QObject(parent)
    , m_settings(new QSettings(settingsFile, QSettings::IniFormat, this))
    , m_clock(clock ? clock : new SystemClock(this))
    , m_connection(new Connection(transport, store, clientName(), this))
    , m_timer(new TimerController(m_clock, this))
    , m_client(new TimerStateClient(m_connection, m_clock, this))
    , m_pomodoroStore(new SettingsPomodoroStore(m_settings, this))
    , m_preferences(new PomodoroPreferences(m_connection, this))
    , m_session(new PomodoroSession(m_clock, m_timer, m_client, m_pomodoroStore, this))
    , m_store(store)
    , m_bus(QString())
{
    qDBusRegisterMetaType<QList<QVariantMap>>();
    qDBusRegisterMetaType<QMap<QString, int>>();
    qDBusRegisterMetaType<QMap<QString, QString>>();
    new Timer1Adaptor(this);

    m_timer->setStateClient(m_client);
    // Each property follows the core signal that announces its change. The
    // countdown is left out: clients count down to PlannedEnd themselves.
    const auto publish = [this] {
        publishChanges();
    };
    connect(m_timer, &TimerController::currentEntryChanged, this, publish);
    connect(m_timer, &TimerController::chainChanged, this, publish);
    connect(m_timer, &TimerController::indicatorChanged, this, publish);
    connect(m_timer, &TimerController::projectsChanged, this, publish);
    connect(m_timer, &TimerController::choiceChanged, this, publish);
    connect(m_timer, &TimerController::entryProjectChanged, this, publish);
    connect(m_timer, &TimerController::statusChanged, this, publish);
    connect(m_session, &PomodoroSession::modeChanged, this, publish);
    connect(m_session, &PomodoroSession::modeLockedChanged, this, publish);
    connect(m_session, &PomodoroSession::sessionChanged, this, publish);
    connect(m_session, &PomodoroSession::canStartSessionChanged, this, publish);
    connect(m_session, &PomodoroSession::ringingChanged, this, publish);
    connect(m_session, &PomodoroSession::messageChanged, this, publish);
    connect(m_preferences, &PomodoroPreferences::changed, this, publish);
    connect(m_preferences, &PomodoroPreferences::stateChanged, this, publish);

    loadSettings();
    m_published = snapshot();
}

TimerService::~TimerService()
{
    if (m_registered) {
        m_bus.unregisterService(serviceName);
        m_bus.unregisterObject(objectPath);
    }
}

bool TimerService::registerOn(QDBusConnection bus)
{
    if (!bus.registerObject(objectPath, this, QDBusConnection::ExportAdaptors)) {
        return false;
    }
    if (!bus.registerService(serviceName)) {
        bus.unregisterObject(objectPath);
        return false;
    }
    m_bus = bus;
    m_registered = true;
    m_published = snapshot();
    return true;
}

Connection *TimerService::connection() const
{
    return m_connection;
}

TimerController *TimerService::timer() const
{
    return m_timer;
}

PomodoroSession *TimerService::session() const
{
    return m_session;
}

bool TimerService::running() const
{
    return m_timer->isRunning();
}

qint64 TimerService::startTime() const
{
    const std::optional<TimeEntry> entry = m_timer->currentEntry();
    return entry && entry->isRunning() ? entry->start.toSecsSinceEpoch() : 0;
}

bool TimerService::paused() const
{
    return m_timer->isPaused();
}

qint64 TimerService::chainSeconds() const
{
    return m_timer->chainSeconds();
}

QString TimerService::indicatorState() const
{
    switch (m_timer->indicatorState()) {
    case TimerController::IndicatorState::None:
        break;
    case TimerController::IndicatorState::Pending:
        return QStringLiteral("pending");
    case TimerController::IndicatorState::Project:
        return QStringLiteral("project");
    }
    return QStringLiteral("none");
}

QString TimerService::indicatorColor() const
{
    return m_timer->indicatorColor();
}

QList<QVariantMap> TimerService::projects() const
{
    // Only the fields the interface names, so no null value reaches the bus.
    QList<QVariantMap> list;
    const QVariantList projects = m_timer->projects();
    for (const QVariant &value : projects) {
        const QVariantMap project = value.toMap();
        list.append({
            {QStringLiteral("id"), project.value(QStringLiteral("id")).toLongLong()},
            {QStringLiteral("name"), project.value(QStringLiteral("name")).toString()},
            {QStringLiteral("clientName"), project.value(QStringLiteral("clientName")).toString()},
            {QStringLiteral("color"), project.value(QStringLiteral("color")).toString()},
            {QStringLiteral("billable"), project.value(QStringLiteral("billable")).toBool()},
        });
    }
    return list;
}

qint64 TimerService::chosenProject() const
{
    const QVariant project = m_timer->chosenProjectId();
    return project.isNull() ? 0 : project.toLongLong();
}

QString TimerService::chosenProjectName() const
{
    const qint64 id = chosenProject();
    if (id == 0) {
        return QString();
    }
    // The running or paused entry's project is resolved by the core even
    // when it is archived and so missing from projects.
    const std::optional<Project> entryProject = m_timer->entryProject();
    if ((m_timer->isRunning() || m_timer->isPaused()) && entryProject && entryProject->id == id) {
        return entryProject->name;
    }
    const QVariantList projects = m_timer->projects();
    for (const QVariant &value : projects) {
        const QVariantMap project = value.toMap();
        if (project.value(QStringLiteral("id")).toLongLong() == id) {
            return project.value(QStringLiteral("name")).toString();
        }
    }
    return QString();
}

bool TimerService::billable() const
{
    return m_timer->chosenBillable();
}

QString TimerService::status() const
{
    switch (m_timer->status()) {
    case TimerController::Unconfigured:
        return QStringLiteral("unconfigured");
    case TimerController::Loading:
        return QStringLiteral("loading");
    case TimerController::Ready:
        return QStringLiteral("ready");
    case TimerController::Busy:
        return QStringLiteral("busy");
    case TimerController::Stale:
        return QStringLiteral("stale");
    case TimerController::AuthenticationBlocked:
        return QStringLiteral("authentication-blocked");
    case TimerController::Error:
        break;
    }
    return QStringLiteral("error");
}

QString TimerService::errorString() const
{
    return m_timer->errorString();
}

bool TimerService::pomodoroMode() const
{
    return m_session->pomodoroMode();
}

bool TimerService::modeLocked() const
{
    return m_session->modeLocked();
}

bool TimerService::sessionActive() const
{
    return m_session->isActive();
}

bool TimerService::canStartSession() const
{
    return m_session->canStartSession();
}

QString TimerService::phase() const
{
    return m_session->phase();
}

qint64 TimerService::phaseStart() const
{
    return unixSeconds(m_session->phaseStart());
}

qint64 TimerService::plannedEnd() const
{
    return unixSeconds(m_session->plannedEnd());
}

int TimerService::pomodoroNumber() const
{
    return m_session->pomodoroNumber();
}

int TimerService::longRestEvery() const
{
    return m_session->longRestEvery();
}

QString TimerService::upcomingPhase() const
{
    return m_session->nextPhase();
}

bool TimerService::ringing() const
{
    return m_session->isRinging();
}

QString TimerService::ringingTransition() const
{
    return m_session->ringingTransition();
}

QString TimerService::sessionMessage() const
{
    return m_session->message();
}

QMap<QString, int> TimerService::pomodoroLengths() const
{
    return {
        {QStringLiteral("work"), m_preferences->workMinutes()},
        {QStringLiteral("shortRest"), m_preferences->shortRestMinutes()},
        {QStringLiteral("longRest"), m_preferences->longRestMinutes()},
        {QStringLiteral("longRestEvery"), m_preferences->longRestEvery()},
    };
}

bool TimerService::pomodoroLengthsEditable() const
{
    return m_preferences->isEditable();
}

QMap<QString, QString> TimerService::pomodoroLengthErrors() const
{
    // Only the refused keys, so an empty map means no error.
    QMap<QString, QString> errors;
    const std::pair<QString, QString> named[] = {
        {QStringLiteral("work"), m_preferences->workMinutesError()},
        {QStringLiteral("shortRest"), m_preferences->shortRestMinutesError()},
        {QStringLiteral("longRest"), m_preferences->longRestMinutesError()},
        {QStringLiteral("longRestEvery"), m_preferences->longRestEveryError()},
        {generalErrorKey, m_preferences->errorString()},
    };
    for (const auto &[key, error] : named) {
        if (!error.isEmpty()) {
            errors.insert(key, error);
        }
    }
    return errors;
}

QMap<QString, QString> TimerService::sounds() const
{
    QMap<QString, QString> sounds;
    for (const TransitionKind kind : transitions) {
        const QString transition = transitionKindName(kind);
        sounds.insert(transition, soundFor(transition));
    }
    return sounds;
}

QList<QVariantMap> TimerService::soundChoices() const
{
    QList<QVariantMap> choices;
    const QList<PomodoroSound> catalogue = pomodoroSounds();
    for (const PomodoroSound &sound : catalogue) {
        choices.append({
            {QStringLiteral("id"), sound.id},
            {QStringLiteral("label"), sound.label},
        });
    }
    return choices;
}

QString TimerService::soundFor(const QString &transition) const
{
    const std::optional<TransitionKind> kind = parseTransitionKind(transition);
    if (!kind) {
        return QString();
    }
    // A stored id the catalogue no longer has falls back to the default.
    const QString stored = m_settings->value(soundKey(*kind)).toString();
    return isSoundId(stored) ? stored : defaultSound(*kind);
}

bool TimerService::Start()
{
    // In Pomodoro mode the desktop starts no timer: sessions run instead.
    return !m_session->pomodoroMode() && m_timer->start();
}

bool TimerService::Stop()
{
    return m_timer->stop();
}

bool TimerService::Pause()
{
    return m_timer->pause();
}

bool TimerService::Resume()
{
    return m_timer->resume();
}

bool TimerService::SetProject(qint64 projectId)
{
    return m_timer->chooseProject(projectId == 0 ? QVariant::fromValue(nullptr) : QVariant(projectId));
}

bool TimerService::SetBillable(bool billable)
{
    return m_timer->chooseBillable(billable);
}

void TimerService::Configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret)
{
    const InstanceUrl instance = parseInstanceUrl(instanceUrl);
    QString invalid;
    if (!instance.isValid()) {
        invalid = instance.error;
    } else if (authMode != QLatin1String("token") && authMode != QLatin1String("password")) {
        invalid = tr("The sign-in method must be \"token\" or \"password\".");
    } else if (authMode == QLatin1String("password") && email.trimmed().isEmpty()) {
        invalid = tr("Enter the email address of your Tokkl account.");
    }
    if (!invalid.isEmpty()) {
        if (calledFromDBus()) {
            sendErrorReply(QDBusError::InvalidArgs, invalid);
        }
        return;
    }

    const AuthMode mode = authModeFromString(authMode);
    // The same cleaning as the KDE Configure page: tokens never carry
    // surrounding whitespace, passwords are used exactly as typed.
    const QString cleaned = mode == AuthMode::Token ? secret.trimmed() : secret;
    const QString url = instance.base.toString();
    const QString address = email.trimmed();
    if (cleaned.isEmpty()) {
        applySettings(url, authMode, address);
        return;
    }

    std::optional<QDBusMessage> call;
    QDBusConnection bus(QString{});
    if (calledFromDBus()) {
        setDelayedReply(true);
        call = message();
        bus = QDBusContext::connection();
    }
    m_store->write(credentialKey(instance, mode, address), cleaned, this, [this, call, bus, url, authMode, address](const CredentialResult &result) {
        if (!result.ok()) {
            if (call) {
                bus.send(call->createErrorReply(credentialStoreError, m_store->message(result)));
            }
            return;
        }
        applySettings(url, authMode, address);
        if (call) {
            bus.send(call->createReply());
        }
    });
}

bool TimerService::SetPomodoroMode(bool pomodoro)
{
    return m_session->setPomodoroMode(pomodoro);
}

QString TimerService::Activate()
{
    switch (m_session->activate()) {
    case PomodoroSession::Activation::Handled:
        break;
    case PomodoroSession::Activation::OpenMenu:
        return QStringLiteral("open-menu");
    case PomodoroSession::Activation::Ignored:
        return QStringLiteral("ignored");
    }
    return QStringLiteral("handled");
}

bool TimerService::StartSession()
{
    return m_session->startSession();
}

bool TimerService::NextPhase()
{
    return m_session->confirmNextPhase();
}

bool TimerService::EndSession()
{
    return m_session->endSession();
}

bool TimerService::SetPomodoroLengths(int work, int shortRest, int longRest, int longRestEvery)
{
    return m_preferences->save(work, shortRest, longRest, longRestEvery);
}

void TimerService::RefreshPreferences()
{
    m_preferences->refresh();
}

bool TimerService::SetSound(const QString &transition, const QString &soundId)
{
    const std::optional<TransitionKind> kind = parseTransitionKind(transition);
    QString invalid;
    if (!kind) {
        invalid = tr("\"%1\" is not a Pomodoro transition.").arg(transition);
    } else if (!isSoundId(soundId)) {
        invalid = tr("\"%1\" is not a Pomodoro sound.").arg(soundId);
    }
    if (!invalid.isEmpty()) {
        if (calledFromDBus()) {
            sendErrorReply(QDBusError::InvalidArgs, invalid);
        }
        return false;
    }
    m_settings->setValue(soundKey(*kind), soundId);
    m_settings->sync();
    const bool stored = m_settings->status() == QSettings::NoError;
    publishChanges();
    return stored;
}

bool TimerService::PreviewSound(const QString &soundId)
{
    if (!isSoundId(soundId)) {
        if (calledFromDBus()) {
            sendErrorReply(QDBusError::InvalidArgs, tr("\"%1\" is not a Pomodoro sound.").arg(soundId));
        }
        return false;
    }
    // Accepted only when a player listens.
    if (!isSignalConnected(QMetaMethod::fromSignal(&TimerService::previewRequested))) {
        return false;
    }
    Q_EMIT previewRequested(soundId);
    return true;
}

void TimerService::loadSettings()
{
    const QString url = m_settings->value(instanceUrlKey).toString();
    if (!url.isEmpty()) {
        m_connection->setInstanceUrl(url);
        m_connection->setAuthModeString(m_settings->value(authModeKey).toString());
        m_connection->setEmail(m_settings->value(emailKey).toString());
    }
}

void TimerService::applySettings(const QString &instanceUrl, const QString &authMode, const QString &email)
{
    m_settings->setValue(instanceUrlKey, instanceUrl);
    m_settings->setValue(authModeKey, authMode);
    m_settings->setValue(emailKey, email);
    m_settings->sync();

    m_connection->setInstanceUrl(instanceUrl);
    m_connection->setAuthModeString(authMode);
    m_connection->setEmail(email);
}

QVariantMap TimerService::snapshot() const
{
    return {
        {QStringLiteral("Running"), running()},
        {QStringLiteral("StartTime"), startTime()},
        {QStringLiteral("Paused"), paused()},
        {QStringLiteral("ChainSeconds"), chainSeconds()},
        {QStringLiteral("IndicatorState"), indicatorState()},
        {QStringLiteral("IndicatorColor"), indicatorColor()},
        {QStringLiteral("Projects"), QVariant::fromValue(projects())},
        {QStringLiteral("ChosenProject"), chosenProject()},
        {QStringLiteral("ChosenProjectName"), chosenProjectName()},
        {QStringLiteral("Billable"), billable()},
        {QStringLiteral("Status"), status()},
        {QStringLiteral("ErrorString"), errorString()},
        {QStringLiteral("PomodoroMode"), pomodoroMode()},
        {QStringLiteral("ModeLocked"), modeLocked()},
        {QStringLiteral("SessionActive"), sessionActive()},
        {QStringLiteral("CanStartSession"), canStartSession()},
        {QStringLiteral("Phase"), phase()},
        {QStringLiteral("PhaseStart"), phaseStart()},
        {QStringLiteral("PlannedEnd"), plannedEnd()},
        {QStringLiteral("PomodoroNumber"), pomodoroNumber()},
        {QStringLiteral("LongRestEvery"), longRestEvery()},
        {QStringLiteral("UpcomingPhase"), upcomingPhase()},
        {QStringLiteral("Ringing"), ringing()},
        {QStringLiteral("RingingTransition"), ringingTransition()},
        {QStringLiteral("SessionMessage"), sessionMessage()},
        {QStringLiteral("PomodoroLengths"), QVariant::fromValue(pomodoroLengths())},
        {QStringLiteral("PomodoroLengthsEditable"), pomodoroLengthsEditable()},
        {QStringLiteral("PomodoroLengthErrors"), QVariant::fromValue(pomodoroLengthErrors())},
        {QStringLiteral("Sounds"), QVariant::fromValue(sounds())},
        {QStringLiteral("SoundChoices"), QVariant::fromValue(soundChoices())},
    };
}

// Sends PropertiesChanged with the properties whose value differs from what
// the bus last saw. A core signal that changed nothing visible sends nothing.
void TimerService::publishChanges()
{
    updateAlarm();
    const QVariantMap current = snapshot();
    QVariantMap changed;
    for (auto it = current.cbegin(); it != current.cend(); ++it) {
        if (m_published.value(it.key()) != it.value()) {
            changed.insert(it.key(), it.value());
        }
    }
    m_published = current;
    if (!m_registered || changed.isEmpty()) {
        return;
    }
    QDBusMessage signal = QDBusMessage::createSignal(objectPath, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("PropertiesChanged"));
    signal << interfaceName << changed << QStringList();
    m_bus.send(signal);
}

// Tells the player when the alarm starts or stops, and which sound the
// ringing transition has.
void TimerService::updateAlarm()
{
    const QString sound = m_session->isRinging() ? soundFor(m_session->ringingTransition()) : QString();
    if (sound == m_alarmSound) {
        return;
    }
    m_alarmSound = sound;
    Q_EMIT alarmChanged(!sound.isEmpty(), sound);
}

}
