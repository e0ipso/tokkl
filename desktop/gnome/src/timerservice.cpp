#include "timerservice.h"

#include "timer1adaptor.h"

#include "configurationadapter.h"
#include "connection.h"
#include "menuactions.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "projectchoices.h"
#include "soundchoices.h"
#include "timercoordinator.h"
#include "timermodel.h"
#include "timerstateclient.h"

#include <QDBusMessage>
#include <QDBusMetaType>

#include <optional>
#include <utility>

namespace Tokkl
{

const QString TimerService::serviceName = QStringLiteral("org.tokkl.Timer1");
const QString TimerService::objectPath = QStringLiteral("/org/tokkl/Timer1");
const QString TimerService::interfaceName = QStringLiteral("org.tokkl.Timer1");

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

TimerService::TimerService(const Parts &parts, QObject *parent)
    : QObject(parent)
    , m_timer(parts.timer)
    , m_actions(parts.actions)
    , m_session(parts.session)
    , m_preferences(parts.preferences)
    , m_sounds(parts.sounds)
    , m_configuration(parts.configuration)
    , m_bus(QString())
{
    qDBusRegisterMetaType<QList<QVariantMap>>();
    qDBusRegisterMetaType<QMap<QString, int>>();
    qDBusRegisterMetaType<QMap<QString, QString>>();
    qDBusRegisterMetaType<QMap<QString, QVariantMap>>();
    qDBusRegisterMetaType<QMap<QString, QMap<QString, int>>>();
    new Timer1Adaptor(this);

    // Each core signal marks the groups whose properties it can change, and
    // the next turn of the event loop publishes them once. The countdown is
    // left out: clients count down to PlannedEnd themselves.
    const auto marking = [this](unsigned groups) {
        return [this, groups] {
            mark(groups);
        };
    };
    for (auto signal : {&TimerModel::currentEntryChanged,
                        &TimerModel::chainChanged,
                        &TimerModel::indicatorChanged,
                        &TimerModel::choiceChanged,
                        &TimerModel::entryProjectChanged,
                        &TimerModel::statusChanged}) {
        connect(m_timer, signal, this, marking(TimerGroup | ActionsGroup));
    }
    // ChosenProjectName reads the list too.
    connect(m_timer, &TimerModel::projectsChanged, this, marking(ProjectsGroup | TimerGroup | ActionsGroup));
    for (auto signal : {&PomodoroSession::modeChanged,
                        &PomodoroSession::modeLockedChanged,
                        &PomodoroSession::sessionChanged,
                        &PomodoroSession::canStartSessionChanged,
                        &PomodoroSession::ringingChanged,
                        &PomodoroSession::messageChanged}) {
        connect(m_session, signal, this, marking(SessionGroup | ActionsGroup));
    }
    connect(m_preferences, &PomodoroPreferences::changed, this, marking(LengthsGroup));
    connect(m_preferences, &PomodoroPreferences::stateChanged, this, marking(LengthsGroup));
    connect(m_sounds, &SoundChoices::changed, this, marking(SoundsGroup));
    connect(m_actions, &TimerCoordinator::writeFinished, this, &TimerService::onWriteFinished);

    m_published = read(AllGroups);
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
    m_dirty = 0;
    m_published = read(AllGroups);
    return true;
}

void TimerService::setAlarm(PomodoroAlarm *alarm)
{
    if (m_alarm) {
        disconnect(m_alarm, nullptr, this, nullptr);
    }
    m_alarm = alarm;
    if (m_alarm) {
        connect(m_alarm, &PomodoroAlarm::failureChanged, this, [this] {
            mark(SoundsGroup);
        });
    }
    mark(SoundsGroup);
}

QString TimerService::alarmError() const
{
    return m_alarm ? m_alarm->failure() : QString();
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
    const TimerStateClient *client = m_timer->stateClient();
    return entry->start.addMSecs(client ? -client->serverOffsetMs() : 0).toSecsSinceEpoch();
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
    case TimerModel::IndicatorState::None:
        break;
    case TimerModel::IndicatorState::Pending:
        return QStringLiteral("pending");
    case TimerModel::IndicatorState::Project:
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
    case TimerModel::Unconfigured:
        return QStringLiteral("unconfigured");
    case TimerModel::Loading:
        return QStringLiteral("loading");
    case TimerModel::Ready:
        return QStringLiteral("ready");
    case TimerModel::Busy:
        return QStringLiteral("busy");
    case TimerModel::Stale:
        return QStringLiteral("stale");
    case TimerModel::AuthenticationBlocked:
        return QStringLiteral("authentication-blocked");
    case TimerModel::Error:
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

QMap<QString, QVariantMap> TimerService::actions() const
{
    // GNOME's menu has always waited for Status ready before it offered a
    // write, and has left Project and Billable to the timer during a
    // session; the policy keeps both.
    const QVariantMap states = MenuActionStates::of(*m_timer, m_session, MenuActionPolicy::gnome()).toVariantMap();
    QMap<QString, QVariantMap> actions;
    for (auto it = states.cbegin(); it != states.cend(); ++it) {
        actions.insert(it.key(), it.value().toMap());
    }
    return actions;
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

QMap<QString, QMap<QString, int>> TimerService::pomodoroLengthLimits() const
{
    // The core's limits are keyed by the preferences' names; the bus keys
    // them as PomodoroLengths.
    const std::pair<QString, QString> keys[] = {
        {QStringLiteral("work"), QStringLiteral("workMinutes")},
        {QStringLiteral("shortRest"), QStringLiteral("shortRestMinutes")},
        {QStringLiteral("longRest"), QStringLiteral("longRestMinutes")},
        {QStringLiteral("longRestEvery"), QStringLiteral("longRestEvery")},
    };
    const QVariantMap limits = PomodoroPreferences::limits();
    QMap<QString, QMap<QString, int>> published;
    for (const auto &[key, name] : keys) {
        const QVariantMap limit = limits.value(name).toMap();
        for (auto it = limit.cbegin(); it != limit.cend(); ++it) {
            published[key].insert(it.key(), it.value().toInt());
        }
    }
    return published;
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
    return answer(!m_session->pomodoroMode() && m_actions->start());
}

bool TimerService::Stop()
{
    return answer(m_actions->stop());
}

bool TimerService::Pause()
{
    return answer(m_actions->pause());
}

bool TimerService::Resume()
{
    return answer(m_actions->resume());
}

qulonglong TimerService::RequestStart()
{
    return answer(follow(!m_session->pomodoroMode() && m_actions->start()));
}

qulonglong TimerService::RequestStop()
{
    return answer(follow(m_actions->stop()));
}

qulonglong TimerService::RequestPause()
{
    return answer(follow(m_actions->pause()));
}

qulonglong TimerService::RequestResume()
{
    return answer(follow(m_actions->resume()));
}

qulonglong TimerService::follow(bool sent)
{
    if (!sent) {
        return 0;
    }
    // The core answers a write later, never while it sends it.
    m_request = ++m_lastRequest;
    return m_request;
}

void TimerService::onWriteFinished(bool ok, const QString &message)
{
    const qulonglong request = std::exchange(m_request, 0);
    if (request == 0) {
        return; // a write from Start, Activate or another plain method
    }
    // The properties the write changed reach the bus first.
    publishChanges();
    Q_EMIT RequestFinished(request, ok, message);
}

bool TimerService::SetProject(qint64 projectId)
{
    return answer(m_actions->chooseProject(projectId == 0 ? QVariant::fromValue(nullptr) : QVariant(projectId)));
}

bool TimerService::SetBillable(bool billable)
{
    return answer(m_actions->chooseBillable(billable));
}

void TimerService::Configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret)
{
    std::optional<ConfigurationAdapter::Call> call;
    if (calledFromDBus()) {
        // The adapter answers once the credential store has.
        setDelayedReply(true);
        call = ConfigurationAdapter::Call{message(), QDBusContext::connection()};
    }
    m_configuration->configure(instanceUrl, authMode, email, secret, call);
    publishChanges();
}

bool TimerService::SetPomodoroMode(bool pomodoro)
{
    return answer(m_session->setPomodoroMode(pomodoro));
}

QString TimerService::Activate()
{
    switch (m_session->activate()) {
    case PomodoroSession::Activation::Handled:
        break;
    case PomodoroSession::Activation::OpenMenu:
        return answer(QStringLiteral("open-menu"));
    case PomodoroSession::Activation::Ignored:
        return answer(QStringLiteral("ignored"));
    }
    return answer(QStringLiteral("handled"));
}

bool TimerService::StartSession()
{
    return answer(m_session->startSession());
}

bool TimerService::NextPhase()
{
    return answer(m_session->confirmNextPhase());
}

bool TimerService::EndSession()
{
    return answer(m_session->endSession());
}

bool TimerService::SetPomodoroLengths(int work, int shortRest, int longRest, int longRestEvery)
{
    return answer(m_preferences->save(work, shortRest, longRest, longRestEvery));
}

void TimerService::RefreshPreferences()
{
    m_preferences->refresh();
    publishChanges();
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
    return answer(m_sounds->choose(*kind, soundId));
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

// ----- publishing ----------------------------------------------------------
//
// Each group reads its properties through their getters, with the types the
// adaptor gives them on the bus.

QVariantMap TimerService::timerProperties() const
{
    return {
        {QStringLiteral("Running"), running()},
        {QStringLiteral("StartTime"), startTime()},
        {QStringLiteral("LocalStartTime"), localStartTime()},
        {QStringLiteral("Paused"), paused()},
        {QStringLiteral("ChainSeconds"), chainSeconds()},
        {QStringLiteral("IndicatorState"), indicatorState()},
        {QStringLiteral("IndicatorColor"), indicatorColor()},
        {QStringLiteral("ChosenProject"), chosenProject()},
        {QStringLiteral("ChosenProjectName"), chosenProjectName()},
        {QStringLiteral("Billable"), billable()},
        {QStringLiteral("Status"), status()},
        {QStringLiteral("ErrorString"), errorString()},
    };
}

QVariantMap TimerService::projectProperties() const
{
    return {
        {QStringLiteral("Projects"), QVariant::fromValue(projects())},
        {QStringLiteral("ProjectsIncomplete"), projectsIncomplete()},
    };
}

QVariantMap TimerService::sessionProperties() const
{
    return {
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
    };
}

QVariantMap TimerService::actionProperties() const
{
    return {{QStringLiteral("Actions"), QVariant::fromValue(actions())}};
}

QVariantMap TimerService::lengthProperties() const
{
    return {
        {QStringLiteral("PomodoroLengths"), QVariant::fromValue(pomodoroLengths())},
        {QStringLiteral("PomodoroLengthsEditable"), pomodoroLengthsEditable()},
        {QStringLiteral("PomodoroLengthErrors"), QVariant::fromValue(pomodoroLengthErrors())},
    };
}

QVariantMap TimerService::soundProperties() const
{
    return {
        {QStringLiteral("Sounds"), QVariant::fromValue(sounds())},
        {QStringLiteral("AlarmError"), alarmError()},
    };
}

QVariantMap TimerService::fixedProperties() const
{
    return {
        {QStringLiteral("PomodoroLengthLimits"), QVariant::fromValue(pomodoroLengthLimits())},
        {QStringLiteral("SoundChoices"), QVariant::fromValue(soundCatalogue())},
    };
}

QVariantMap TimerService::read(unsigned groups) const
{
    using Reader = QVariantMap (TimerService::*)() const;
    const std::pair<Group, Reader> readers[] = {
        {TimerGroup, &TimerService::timerProperties},
        {ProjectsGroup, &TimerService::projectProperties},
        {SessionGroup, &TimerService::sessionProperties},
        {ActionsGroup, &TimerService::actionProperties},
        {LengthsGroup, &TimerService::lengthProperties},
        {SoundsGroup, &TimerService::soundProperties},
        {FixedGroup, &TimerService::fixedProperties},
    };
    QVariantMap values;
    for (const auto &[group, reader] : readers) {
        if (groups & group) {
            values.insert((this->*reader)());
        }
    }
    return values;
}

void TimerService::mark(unsigned groups)
{
    m_dirty |= groups;
    if (m_publishQueued) {
        return;
    }
    m_publishQueued = true;
    QMetaObject::invokeMethod(
        this,
        [this] {
            m_publishQueued = false;
            publishChanges();
        },
        Qt::QueuedConnection);
}

// Sends PropertiesChanged with the properties of the marked groups whose
// value differs from what the bus last saw. A core signal that changed
// nothing visible sends nothing.
void TimerService::publishChanges()
{
    const unsigned groups = std::exchange(m_dirty, 0u);
    if (groups == 0) {
        return;
    }
    const QVariantMap current = read(groups);
    QVariantMap changed;
    for (auto it = current.cbegin(); it != current.cend(); ++it) {
        if (m_published.value(it.key()) != it.value()) {
            changed.insert(it.key(), it.value());
            m_published.insert(it.key(), it.value());
        }
    }
    if (!m_registered || changed.isEmpty()) {
        return;
    }
    QDBusMessage signal = QDBusMessage::createSignal(objectPath, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("PropertiesChanged"));
    signal << interfaceName << changed << QStringList();
    m_bus.send(signal);
}

}
