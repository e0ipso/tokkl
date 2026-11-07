#include "timerservice.h"

#include "timer1adaptor.h"

#include "clock.h"
#include "connection.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "pomodorostore.h"
#include "projectchoices.h"
#include "servicesettings.h"
#include "soundchoices.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <QDBusMessage>
#include <QDBusMetaType>
#include <QMetaProperty>
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
}

QString TimerService::soundKey(TransitionKind kind)
{
    return QStringLiteral("Sounds/") + transitionKindName(kind);
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
    , m_sounds(new SoundChoices(m_settings, &TimerService::soundKey, this))
    , m_preferences(new PomodoroPreferences(m_connection, this))
    , m_connectionSettings(new ServiceSettings(m_settings, m_connection, store, this))
    , m_bus(QString())
{
    qDBusRegisterMetaType<QList<QVariantMap>>();
    qDBusRegisterMetaType<QMap<QString, int>>();
    qDBusRegisterMetaType<QMap<QString, QString>>();
    new Timer1Adaptor(this);

    m_timer->setStateClient(m_client);
    // The session reads and acts through the timer's state client.
    m_session = new PomodoroSession(m_clock, m_timer->coordinator(), m_pomodoroStore, this);
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
    connect(m_sounds, &SoundChoices::changed, this, publish);

    m_connectionSettings->load();
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

PomodoroSession *TimerService::session() const
{
    return m_session;
}

SoundChoices *TimerService::soundChoices() const
{
    return m_sounds;
}

void TimerService::setAlarm(PomodoroAlarm *alarm)
{
    m_alarm = alarm;
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

qint64 TimerService::localStartTime() const
{
    const std::optional<TimeEntry> entry = m_timer->currentEntry();
    if (!entry || !entry->isRunning()) {
        return 0;
    }
    // serverNow() is this machine's clock plus the offset, so the start on
    // this clock is the server's start minus it.
    return entry->start.addMSecs(-m_client->serverOffsetMs()).toSecsSinceEpoch();
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
    // The active projects of the core's project choices, with only the
    // fields the interface names, so no null value reaches the bus.
    QList<QVariantMap> list;
    const ProjectChoices choices = m_timer->projectChoices();
    for (const ProjectChoices::Row &row : choices.rows) {
        if (row.kind != ProjectChoices::Row::Kind::Project) {
            continue;
        }
        list.append({
            {QStringLiteral("id"), row.project.id},
            {QStringLiteral("name"), row.project.name},
            {QStringLiteral("clientName"), row.project.clientName},
            {QStringLiteral("color"), row.project.color},
            {QStringLiteral("billable"), row.project.billable},
        });
    }
    return list;
}

bool TimerService::projectsIncomplete() const
{
    return m_timer->projectChoices().incomplete();
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
        sounds.insert(transitionKindName(kind), m_sounds->chosen(kind));
    }
    return sounds;
}

QList<QVariantMap> TimerService::soundCatalogue() const
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
    std::optional<QDBusMessage> call;
    QDBusConnection bus(QString{});
    if (calledFromDBus()) {
        setDelayedReply(true);
        call = message();
        bus = QDBusContext::connection();
    }
    m_connectionSettings->configure(instanceUrl, authMode, email, secret, [call, bus](const ServiceSettings::Outcome &outcome) {
        if (!call) {
            return;
        }
        switch (outcome.kind) {
        case ServiceSettings::Outcome::Kind::Saved:
            bus.send(call->createReply());
            break;
        case ServiceSettings::Outcome::Kind::Invalid:
            bus.send(call->createErrorReply(QDBusError::InvalidArgs, outcome.message));
            break;
        case ServiceSettings::Outcome::Kind::StoreRefused:
            bus.send(call->createErrorReply(credentialStoreError, outcome.message));
            break;
        case ServiceSettings::Outcome::Kind::NotWritten:
            bus.send(call->createErrorReply(QDBusError::Failed, outcome.message));
            break;
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
    // A choice the file cannot keep is not taken, so Sounds keeps showing
    // the one stored.
    return m_sounds->choose(*kind, soundId);
}

bool TimerService::PreviewSound(const QString &soundId)
{
    if (!isSoundId(soundId)) {
        if (calledFromDBus()) {
            sendErrorReply(QDBusError::InvalidArgs, tr("\"%1\" is not a Pomodoro sound.").arg(soundId));
        }
        return false;
    }
    // Accepted only when an alarm plays it.
    if (!m_alarm) {
        return false;
    }
    m_alarm->preview(soundId);
    return true;
}

// Every org.tokkl.Timer1 property, read as the adaptor reads it.
QVariantMap TimerService::snapshot() const
{
    QVariantMap values;
    const QMetaObject &meta = staticMetaObject;
    for (int i = meta.propertyOffset(); i < meta.propertyCount(); ++i) {
        const QMetaProperty property = meta.property(i);
        values.insert(QString::fromLatin1(property.name()), property.read(this));
    }
    return values;
}

// Sends PropertiesChanged with the properties whose value differs from what
// the bus last saw. A core signal that changed nothing visible sends nothing.
void TimerService::publishChanges()
{
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

}
