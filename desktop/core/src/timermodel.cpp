#include "timermodel.h"

#include "chosenproject.h"
#include "nextstartselection.h"
#include "projectcatalog.h"

#include <algorithm>

namespace Tokkl
{

TimerModel::TimerModel(QObject *parent)
    : QObject(parent)
    , m_catalog(new ProjectCatalog(
          [this] {
              return !workspaceAccessLost();
          },
          this))
    , m_chosen(new ChosenProject(
          m_catalog,
          [this] {
              return chosenProject();
          },
          this))
    , m_next(new NextStartSelection(m_catalog, this))
{
    connect(m_next, &NextStartSelection::changed, this, &TimerModel::selectionChanged);
    connect(m_catalog, &ProjectCatalog::listChanged, this, &TimerModel::projectsChanged);
    connect(m_catalog, &ProjectCatalog::projectResolved, this, &TimerModel::resolveProject);
    connect(m_chosen, &ChosenProject::entryProjectChanged, this, &TimerModel::entryProjectChanged);
    connect(m_chosen, &ChosenProject::indicatorChanged, this, &TimerModel::indicatorChanged);
    connect(this, &TimerModel::selectionChanged, this, &TimerModel::choiceChanged);
    connect(this, &TimerModel::currentEntryChanged, this, &TimerModel::choiceChanged);
    connect(this, &TimerModel::chainChanged, this, &TimerModel::choiceChanged);
    for (auto signal : {&TimerModel::choiceChanged, &TimerModel::entryProjectChanged, &TimerModel::projectsChanged}) {
        connect(this, signal, this, &TimerModel::chosenProjectDetailsChanged);
    }
    // A new next-start project may need its details read.
    connect(this, &TimerModel::selectionChanged, this, &TimerModel::resolveProject);
    for (auto signal : {&TimerModel::choiceChanged, &TimerModel::entryProjectChanged, &TimerModel::projectsChanged}) {
        connect(this, signal, this, &TimerModel::updateProjectChoices);
    }
}

TimerModel::~TimerModel() = default;

void TimerModel::setActivity(const TimerActivity *activity)
{
    m_activity = activity;
}

void TimerModel::bind(TimerStateClient *client, Clock *clock)
{
    m_state = client;
    m_connection = client ? client->connection() : nullptr;
    m_next->setConnection(m_connection);
    if (clock == m_clock) {
        return;
    }
    if (m_clock) {
        disconnect(m_clock, &Clock::ticked, this, &TimerModel::updateElapsed);
    }
    m_clock = clock;
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &TimerModel::updateElapsed);
    }
}

Clock *TimerModel::clock() const
{
    return m_clock;
}

ProjectCatalog *TimerModel::catalog() const
{
    return m_catalog;
}

NextStartSelection *TimerModel::next() const
{
    return m_next;
}

TimerStateClient *TimerModel::stateClient() const
{
    return m_state;
}

Connection *TimerModel::connection() const
{
    return m_connection;
}

bool TimerModel::isConnected() const
{
    return m_connection && m_connection->isConnected();
}

QVariantMap TimerModel::account() const
{
    return m_connection ? m_connection->accountMap() : QVariantMap();
}

qint64 TimerModel::workspaceId() const
{
    return m_connection ? m_connection->workspaceId() : 0;
}

Connection::State TimerModel::connectionState() const
{
    return m_connection ? m_connection->state() : Connection::Unconfigured;
}

bool TimerModel::isStale() const
{
    return m_connection && m_connection->isStale();
}

bool TimerModel::workspaceAccessLost() const
{
    return m_activity && m_activity->workspaceLost();
}

bool TimerModel::isBusy() const
{
    return (m_activity && m_activity->writing()) || (m_state && m_state->settling());
}

bool TimerModel::canWrite() const
{
    return m_connection && m_connection->canWrite() && m_clock && m_state && !workspaceAccessLost() && heldState() && !isBusy();
}

bool TimerModel::canStartNew() const
{
    return canWrite() && !isRunning() && !isPaused() && !isSessionActive();
}

QString TimerModel::errorString() const
{
    const QString message = m_activity ? m_activity->message() : QString();
    if (!message.isEmpty()) {
        return message;
    }
    if (m_connection && m_connection->state() != Connection::Connected) {
        return m_connection->errorString();
    }
    return QString();
}

TimerModel::Status TimerModel::status() const
{
    if (!m_connection) {
        return Unconfigured;
    }
    switch (m_connection->state()) {
    case Connection::Unconfigured:
    case Connection::CredentialsMissing:
        return Unconfigured;
    case Connection::LoadingCredentials:
    case Connection::Connecting:
        return Loading;
    case Connection::AuthenticationFailed:
        return AuthenticationBlocked;
    case Connection::InvalidSettings:
    case Connection::WalletError:
    case Connection::RateLimited:
    case Connection::Error:
        return isBusy() ? Busy : Error;
    case Connection::Disconnected:
        if (isBusy()) {
            return Busy;
        }
        // A bound account keeps its data through a connectivity failure.
        return isConnected() ? Stale : Error;
    case Connection::Connected:
        break;
    }
    if (isBusy()) {
        return Busy;
    }
    if (workspaceAccessLost() || (m_activity && !m_activity->message().isEmpty())) {
        return Error;
    }
    if (isStale()) {
        return Stale;
    }
    return heldState() ? Ready : Loading;
}

std::optional<TimeEntry> TimerModel::currentEntry() const
{
    return m_shown.entry;
}

QVariant TimerModel::currentEntryVariant() const
{
    return m_shown.entry ? QVariant(m_shown.entry->toVariantMap()) : QVariant::fromValue(nullptr);
}

bool TimerModel::isRunning() const
{
    return m_shown.entry.has_value();
}

qint64 TimerModel::elapsedSeconds() const
{
    return m_elapsed;
}

QString TimerModel::elapsedText() const
{
    return formatElapsed(m_elapsed);
}

bool TimerModel::isPaused() const
{
    return m_shown.paused();
}

qint64 TimerModel::chainSeconds() const
{
    return m_shown.chain ? m_shown.chain->seconds : 0;
}

bool TimerModel::isSessionActive() const
{
    return m_shown.session;
}

QVariantList TimerModel::projects() const
{
    QVariantList list;
    for (const Project &project : m_catalog->projects()) {
        list.append(project.toVariantMap());
    }
    return list;
}

bool TimerModel::projectsIncomplete() const
{
    return m_catalog->incomplete();
}

ProjectChoices TimerModel::projectChoices() const
{
    const bool held = isRunning() || isPaused();
    return ProjectChoices::build(m_catalog->projects(), m_catalog->incomplete(), chosenProject(), held ? m_chosen->entryProject() : std::nullopt, canWrite() && !held);
}

QVariantList TimerModel::projectChoicesVariant() const
{
    return m_projectChoices;
}

void TimerModel::updateProjectChoices()
{
    const QVariantList choices = projectChoices().toVariantList();
    if (choices != m_projectChoices) {
        m_projectChoices = choices;
        Q_EMIT projectChoicesChanged();
    }
}

QVariant TimerModel::selectedProjectId() const
{
    return m_next->projectIdVariant();
}

bool TimerModel::billable() const
{
    return m_next->billable();
}

QVariant TimerModel::chosenProjectId() const
{
    if (isRunning() || isPaused()) {
        const std::optional<qint64> project = chosenProject();
        return project ? QVariant(*project) : QVariant::fromValue(nullptr);
    }
    return selectedProjectId();
}

std::optional<qint64> TimerModel::chosenProject() const
{
    if (m_shown.entry) {
        return m_shown.entry->projectId;
    }
    if (isPaused()) {
        return m_shown.chain->projectId;
    }
    return m_next->projectId();
}

bool TimerModel::chosenBillable() const
{
    if (m_shown.entry) {
        return m_shown.entry->billable;
    }
    return isPaused() ? m_shown.chain->billable : billable();
}

std::optional<Project> TimerModel::entryProject() const
{
    return m_chosen->entryProject();
}

QVariant TimerModel::entryProjectVariant() const
{
    const std::optional<Project> &project = m_chosen->entryProject();
    return project ? QVariant(project->toVariantMap()) : QVariant::fromValue(nullptr);
}

QVariant TimerModel::chosenProjectDetails() const
{
    const std::optional<Project> project = m_chosen->details(chosenProject(), isRunning() || isPaused());
    return project ? QVariant(project->toVariantMap()) : QVariant::fromValue(nullptr);
}

TimerModel::IndicatorState TimerModel::indicatorState() const
{
    switch (m_chosen->indicator().state) {
    case ProjectCatalog::Indicator::State::None:
        break;
    case ProjectCatalog::Indicator::State::Pending:
        return IndicatorState::Pending;
    case ProjectCatalog::Indicator::State::Project:
        return IndicatorState::Project;
    }
    return IndicatorState::None;
}

QString TimerModel::indicatorColor() const
{
    return m_chosen->indicator().color;
}

QString TimerModel::formatElapsed(qint64 seconds)
{
    // Whole minutes; the seconds are dropped, not rounded.
    seconds = std::max<qint64>(0, seconds);
    return QStringLiteral("%1:%2").arg(seconds / 3600).arg((seconds % 3600) / 60, 2, 10, QLatin1Char('0'));
}

// ----- driven by the coordinator -------------------------------------------

const std::optional<TimerState> &TimerModel::heldState() const
{
    static const std::optional<TimerState> none;
    return m_state ? m_state->state() : none;
}

bool TimerModel::readable() const
{
    return m_connection && m_connection->isConnected() && !workspaceAccessLost() && !m_connection->rateLimitedUntil().isValid();
}

TimerModel::Change TimerModel::stage()
{
    const TimerView shown = TimerView::of(heldState(), workspaceId(), workspaceAccessLost());
    Change change;
    change.was = m_shown.entry;
    change.entryChanged = shown.entry != m_shown.entry;
    change.chainChanged = !TimerView::sameChain(shown.chain, m_shown.chain);
    change.sessionChanged = shown.session != m_shown.session;
    change.stopped = change.was.has_value() && !shown.entry.has_value() && heldState() && !workspaceAccessLost() && !shown.session;
    m_shown = shown;
    return change;
}

void TimerModel::publish(const Change &change)
{
    if (change.entryChanged) {
        Q_EMIT currentEntryChanged();
    }
    if (change.chainChanged) {
        Q_EMIT chainChanged();
    }
    if (change.sessionChanged) {
        Q_EMIT sessionActiveChanged();
    }
    updateElapsed();
    resolveProject();
}

void TimerModel::resolveProject()
{
    m_chosen->update(chosenProject(), isRunning() || isPaused(), readable() ? m_connection.data() : nullptr, workspaceId());
}

void TimerModel::updateElapsed()
{
    qint64 elapsed = 0;
    if (isPaused()) {
        elapsed = m_shown.chain->seconds;
    } else if (m_shown.entry && m_state) {
        // The chain is shown only with this entry as its clone.
        elapsed = std::max<qint64>(0, m_shown.entry->start.secsTo(m_state->serverNow())) + chainSeconds();
    }
    if (elapsed != m_elapsed) {
        m_elapsed = elapsed;
        Q_EMIT elapsedChanged();
    }
}

}
