#include "timercontroller.h"

#include "chosenproject.h"
#include "logging.h"
#include "nextstartselection.h"
#include "projectcatalog.h"

#include <algorithm>
#include <utility>

namespace Tokkl
{

namespace
{
using Outcome = TimerActionResult::Outcome;

Outcome outcomeOf(const ApiError &error, bool succeeded)
{
    if (succeeded) {
        return Outcome::Applied;
    }
    return error.outcomeUnknown() ? Outcome::Unknown : Outcome::Refused;
}
}

TimerController::TimerController(QObject *parent)
    : TimerController(nullptr, parent)
{
    m_clientClock = true;
}

TimerController::TimerController(Clock *clock, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
    , m_catalog(new ProjectCatalog(
          [this] {
              return !m_workspaceLost;
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
    connect(m_next, &NextStartSelection::changed, this, &TimerController::selectionChanged);
    connect(m_catalog, &ProjectCatalog::listChanged, this, &TimerController::projectsChanged);
    connect(m_catalog, &ProjectCatalog::listLoaded, this, [this] {
        m_next->listLoaded();
        resolveProject();
    });
    connect(m_catalog, &ProjectCatalog::projectResolved, this, &TimerController::resolveProject);
    connect(m_catalog, &ProjectCatalog::readFailed, this, [this](const ApiError &error) {
        if (error.kind == ApiError::Kind::Forbidden) {
            loseWorkspace(error);
        } else {
            Q_EMIT statusChanged();
        }
    });
    connect(m_chosen, &ChosenProject::entryProjectChanged, this, &TimerController::entryProjectChanged);
    connect(m_chosen, &ChosenProject::indicatorChanged, this, &TimerController::indicatorChanged);
    connect(this, &TimerController::selectionChanged, this, &TimerController::choiceChanged);
    connect(this, &TimerController::currentEntryChanged, this, &TimerController::choiceChanged);
    connect(this, &TimerController::chainChanged, this, &TimerController::choiceChanged);
    for (auto signal : {&TimerController::choiceChanged, &TimerController::entryProjectChanged, &TimerController::projectsChanged}) {
        connect(this, signal, this, &TimerController::chosenProjectDetailsChanged);
    }
    // A new next-start project may need its details read.
    connect(this, &TimerController::selectionChanged, this, &TimerController::resolveProject);
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
    }
}

TimerController::~TimerController() = default;

TimerStateClient *TimerController::stateClient() const
{
    return m_state;
}

void TimerController::setStateClient(TimerStateClient *client)
{
    if (client == m_state) {
        return;
    }
    detach();
    m_state = client;
    m_connection = client ? client->connection() : nullptr;
    m_next->setConnection(m_connection);
    if (m_clientClock) {
        if (m_clock) {
            disconnect(m_clock, &Clock::ticked, this, &TimerController::onTick);
        }
        m_clock = client ? client->clock() : nullptr;
        if (m_clock) {
            connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
        }
    }
    if (m_state) {
        connect(m_state, &TimerStateClient::stateChanged, this, &TimerController::onStateChanged);
        connect(m_state, &TimerStateClient::settlingChanged, this, &TimerController::onSettlingChanged);
        connect(m_state, &QObject::destroyed, this, [this] {
            detach();
            reset();
            Q_EMIT connectionChanged();
        });
    }
    if (m_connection) {
        connect(m_connection, &Connection::generationChanged, this, &TimerController::onGenerationChanged);
        connect(m_connection, &Connection::stateChanged, this, &TimerController::onConnectionChanged);
        connect(m_connection, &Connection::accountChanged, this, &TimerController::onConnectionChanged);
        connect(m_connection, &QObject::destroyed, this, &TimerController::reset);
    }
    reset();
    Q_EMIT connectionChanged();
    Q_EMIT selectionChanged();
    onConnectionChanged();
    // A state the client already holds.
    onStateChanged();
}

void TimerController::detach()
{
    if (m_state) {
        disconnect(m_state, nullptr, this, nullptr);
    }
    if (m_connection) {
        disconnect(m_connection, nullptr, this, nullptr);
    }
    m_state = nullptr;
    m_connection = nullptr;
    m_next->setConnection(nullptr);
}

Connection *TimerController::connection() const
{
    return m_connection;
}

bool TimerController::isConnected() const
{
    return m_connection && m_connection->isConnected();
}

QVariantMap TimerController::account() const
{
    return m_connection ? m_connection->accountMap() : QVariantMap();
}

qint64 TimerController::workspaceId() const
{
    return m_connection ? m_connection->workspaceId() : 0;
}

Connection::State TimerController::connectionState() const
{
    return m_connection ? m_connection->state() : Connection::Unconfigured;
}

bool TimerController::isStale() const
{
    return m_connection && m_connection->isStale();
}

bool TimerController::workspaceAccessLost() const
{
    return m_workspaceLost;
}

bool TimerController::isBusy() const
{
    return m_gate.running() || (m_state && m_state->settling());
}

bool TimerController::canWrite() const
{
    return m_connection && m_connection->canWrite() && m_clock && m_state && !m_workspaceLost && heldState() && !isBusy();
}

bool TimerController::canStartNew() const
{
    return canWrite() && !isRunning() && !isPaused() && !isSessionActive();
}

QString TimerController::errorString() const
{
    if (!m_error.isEmpty()) {
        return m_error;
    }
    if (m_connection && m_connection->state() != Connection::Connected) {
        return m_connection->errorString();
    }
    return QString();
}

TimerController::Status TimerController::status() const
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
    if (m_workspaceLost || !m_error.isEmpty()) {
        return Error;
    }
    if (isStale()) {
        return Stale;
    }
    return heldState() ? Ready : Loading;
}

std::optional<TimeEntry> TimerController::currentEntry() const
{
    return m_shown.entry;
}

QVariant TimerController::currentEntryVariant() const
{
    return m_shown.entry ? QVariant(m_shown.entry->toVariantMap()) : QVariant::fromValue(nullptr);
}

bool TimerController::isRunning() const
{
    return m_shown.entry.has_value();
}

qint64 TimerController::elapsedSeconds() const
{
    return m_elapsed;
}

QString TimerController::elapsedText() const
{
    return formatElapsed(m_elapsed);
}

bool TimerController::isPaused() const
{
    return m_shown.paused();
}

qint64 TimerController::chainSeconds() const
{
    return m_shown.chain ? m_shown.chain->seconds : 0;
}

bool TimerController::isSessionActive() const
{
    return m_shown.session;
}

QVariantList TimerController::projects() const
{
    QVariantList list;
    for (const Project &project : m_catalog->projects()) {
        list.append(project.toVariantMap());
    }
    return list;
}

bool TimerController::projectsIncomplete() const
{
    return m_catalog->incomplete();
}

QVariant TimerController::selectedProjectId() const
{
    return m_next->projectIdVariant();
}

void TimerController::setSelectedProjectId(const QVariant &projectId)
{
    m_next->pickProjectId(projectId);
}

bool TimerController::billable() const
{
    return m_next->billable();
}

void TimerController::setBillable(bool billable)
{
    m_next->pickBillable(billable);
}

QVariant TimerController::chosenProjectId() const
{
    if (isRunning() || isPaused()) {
        const std::optional<qint64> project = chosenProject();
        return project ? QVariant(*project) : QVariant::fromValue(nullptr);
    }
    return selectedProjectId();
}

bool TimerController::chosenBillable() const
{
    if (m_shown.entry) {
        return m_shown.entry->billable;
    }
    return isPaused() ? m_shown.chain->billable : billable();
}

std::optional<Project> TimerController::entryProject() const
{
    return m_chosen->entryProject();
}

QVariant TimerController::entryProjectVariant() const
{
    const std::optional<Project> &project = m_chosen->entryProject();
    return project ? QVariant(project->toVariantMap()) : QVariant::fromValue(nullptr);
}

QVariant TimerController::chosenProjectDetails() const
{
    const std::optional<Project> project = m_chosen->details(chosenProject(), isRunning() || isPaused());
    return project ? QVariant(project->toVariantMap()) : QVariant::fromValue(nullptr);
}

TimerController::IndicatorState TimerController::indicatorState() const
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

QString TimerController::indicatorColor() const
{
    return m_chosen->indicator().color;
}

QString TimerController::formatElapsed(qint64 seconds)
{
    // Whole minutes; the seconds are dropped, not rounded.
    seconds = std::max<qint64>(0, seconds);
    return QStringLiteral("%1:%2").arg(seconds / 3600).arg((seconds % 3600) / 60, 2, 10, QLatin1Char('0'));
}

// ----- actions -------------------------------------------------------------

bool TimerController::start()
{
    if (!canStartNew()) {
        return false;
    }
    m_next->started();
    StartEntry entry;
    entry.start = m_clock->now().toUTC();
    entry.projectId = m_next->projectId();
    entry.billable = m_next->billable();
    beginMutation();

    m_connection->startEntry(entry, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        finishMutation(outcomeOf(result.error, result.ok()), result.error, true, true);
    }));
    return true;
}

bool TimerController::stop()
{
    if (isSessionActive()) {
        return false;
    }
    if (isPaused()) {
        if (!canWrite()) {
            return false;
        }
        beginMutation();
        m_state->discard(m_epoch.guard(this, [this](const TimerActionResult &result) {
            finishMutation(result.outcome, result.error);
        }));
        return true;
    }
    if (!canWrite() || !isRunning()) {
        return false;
    }
    const qint64 entryId = m_shown.entry->id;
    beginMutation();

    m_connection->stopEntry(entryId, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        if (result.ok()) {
            m_stopReply = result.value;
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

bool TimerController::pause()
{
    if (!canWrite() || !isRunning()) {
        return false;
    }
    beginMutation();

    m_state->pause(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error);
    }));
    return true;
}

bool TimerController::resume()
{
    if (!canWrite() || isRunning() || !isPaused()) {
        return false;
    }
    m_next->started();
    beginMutation();

    m_state->resume(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error, true);
    }));
    return true;
}

bool TimerController::toggle()
{
    if (isSessionActive()) {
        return false;
    }
    if (isRunning()) {
        return pause();
    }
    return isPaused() ? resume() : start();
}

bool TimerController::chooseProject(const QVariant &projectId)
{
    // The project of a running or paused entry is fixed until it stops.
    if (!canWrite() || isRunning() || isPaused()) {
        return false;
    }
    const std::optional<NextStartSelection::Choice> choice = NextStartSelection::forProject(projectId, m_catalog->projects());
    if (!choice) {
        return false;
    }
    clearKeptError();
    m_next->pick(*choice);
    return true;
}

bool TimerController::chooseBillable(bool billable)
{
    // A resume copies the chain's flag.
    if (!canWrite() || isPaused()) {
        return false;
    }
    clearKeptError();
    m_next->pickBillable(billable);
    if (!isRunning() || m_shown.entry->billable == billable) {
        return true;
    }
    TimeEntryUpdate update;
    update.billable = billable;
    return updateEntry(update);
}

bool TimerController::updateEntry(const TimeEntryUpdate &update)
{
    // Only the fields in the update travel; the server keeps the entry's
    // start, description, tags and the rest, and it keeps running.
    const qint64 entryId = m_shown.entry->id;
    beginMutation();

    m_connection->updateEntry(entryId, update, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        // Stopped elsewhere before the edit: the reply names its project.
        if (result.ok() && !result.value->isRunning()) {
            m_stopReply = result.value;
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

void TimerController::beginMutation()
{
    m_gate.begin();
    setError(QString());
    Q_EMIT statusChanged();
}

void TimerController::finishMutation(Outcome outcome, const ApiError &error, bool start, bool entryReply)
{
    if (outcome != Outcome::Applied) {
        qCInfo(lcTimer) << "Timer change ended with" << outcome << error.message;
    }
    const MutationGate::Ending ending = m_gate.finish(outcome, error, start, entryReply);
    if (ending.settle && m_state && !m_state->settling()) {
        m_state->settle();
    }
    if (m_workspaceLost) {
        Q_EMIT statusChanged();
        return;
    }

    switch (ending.message) {
    case MutationGate::Message::Clear:
        setError(QString());
        break;
    case MutationGate::Message::Show:
        setError(error.message);
        break;
    case MutationGate::Message::Keep:
        setError(error.message);
        m_keepError = true;
        break;
    case MutationGate::Message::Conflict:
        // The state the server sent instead is shown already.
        setError(tr("The timer changed on another device first."));
        m_keepError = true;
        break;
    case MutationGate::Message::LoseWorkspace:
        loseWorkspace(error);
        return;
    }
    if (ending.refresh && m_state) {
        m_state->refresh();
    }
    Q_EMIT statusChanged();
}

void TimerController::loseWorkspace(const ApiError &error)
{
    qCWarning(lcTimer) << "Workspace refused (403); writes blocked until reconnect:" << error.message;
    m_workspaceLost = true;
    // A write in flight keeps its lock until it answers, and the server
    // state stays unknown until a read after that answer.
    m_gate.settleWhenDone();
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    m_catalog->forget();
    applyView();
    m_catalog->clearList();
    m_next->forget();
    // The account may have another workspace now. Ask once; a different
    // default workspace starts a new generation, which lifts the block.
    if (m_connection && !m_rediscoveryUsed) {
        m_rediscoveryUsed = true;
        m_connection->fetchMe();
    }
    Q_EMIT statusChanged();
}

// ----- reads ---------------------------------------------------------------

void TimerController::refresh()
{
    if (m_state && readable()) {
        m_state->refresh();
    }
    fetchProjects();
}

void TimerController::resumed()
{
    if (m_state) {
        m_state->resumed();
    }
    fetchProjects();
}

void TimerController::reconnect()
{
    if (!m_connection) {
        return;
    }
    const bool wasLost = std::exchange(m_workspaceLost, false);
    m_rediscoveryUsed = false;
    m_next->wantLastEntry();
    setError(QString());
    if (wasLost) {
        // Shows the entry and chain of the state held again.
        applyView();
    }
    Q_EMIT statusChanged();
    m_connection->reconnect();
    if (isConnected()) {
        // The account stays bound through revalidation; no state change
        // would trigger the reload. The state that answers also replaces an
        // automatic next-start default with the last entry's project.
        refresh();
    }
}

bool TimerController::readable() const
{
    return m_connection && m_connection->isConnected() && !m_workspaceLost && !m_connection->rateLimitedUntil().isValid();
}

void TimerController::onStateChanged()
{
    applyView();
    if (!heldState()) {
        // A new generation, or no client.
        Q_EMIT statusChanged();
        return;
    }
    if (!isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    // The first state of a connection. A running entry sets the default
    // when it stops; otherwise ask for the last one.
    if (!isSessionActive() && m_next->takeLastEntryWanted() && !isRunning() && readable()) {
        m_next->readLastEntry([this] {
            return !m_workspaceLost && !isRunning();
        });
    }
    Q_EMIT statusChanged();
}

void TimerController::onSettlingChanged()
{
    // Settled by a read whose state may be older than the one held, so no
    // state change says so.
    if (!isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    Q_EMIT statusChanged();
}

void TimerController::fetchProjects()
{
    if (readable()) {
        m_catalog->fetch(m_connection);
    }
}

const std::optional<TimerState> &TimerController::heldState() const
{
    static const std::optional<TimerState> none;
    return m_state ? m_state->state() : none;
}

void TimerController::applyView()
{
    const TimerView shown = TimerView::of(heldState(), workspaceId(), m_workspaceLost);
    const std::optional<TimeEntry> &was = m_shown.entry;
    const bool entryChanged = shown.entry != was;
    const bool chainChanged = !TimerView::sameChain(shown.chain, m_shown.chain);
    const bool sessionChanged = shown.session != m_shown.session;
    // A stop the state shows, not a context that went away.
    const bool stopped = was.has_value() && !shown.entry.has_value() && heldState() && !m_workspaceLost && !shown.session;
    std::optional<qint64> stoppedProject;
    if (stopped) {
        if (m_stopReply && m_stopReply->id == was->id) {
            stoppedProject = m_stopReply->projectId;
        } else {
            // A pause names the project the server stopped.
            stoppedProject = shown.paused() ? shown.chain->projectId : was->projectId;
        }
    }
    // A stop reply counts only for the stop of the entry it names.
    if (m_stopReply && (stopped || !shown.entry || m_stopReply->id != shown.entry->id)) {
        m_stopReply.reset();
    }
    m_shown = shown;
    if (m_shown.entry) {
        m_next->entryRunning();
    }
    if (stopped) {
        m_next->stopped(stoppedProject);
    }
    if (entryChanged) {
        Q_EMIT currentEntryChanged();
    }
    if (chainChanged) {
        Q_EMIT this->chainChanged();
    }
    if (sessionChanged) {
        Q_EMIT sessionActiveChanged();
    }
    updateElapsed();
    resolveProject();
}

std::optional<qint64> TimerController::chosenProject() const
{
    if (m_shown.entry) {
        return m_shown.entry->projectId;
    }
    if (isPaused()) {
        return m_shown.chain->projectId;
    }
    return m_next->projectId();
}

void TimerController::resolveProject()
{
    m_chosen->update(chosenProject(), isRunning() || isPaused(), readable() ? m_connection.data() : nullptr, workspaceId());
}

// ----- clock and connection ------------------------------------------------

void TimerController::onTick()
{
    updateElapsed();
}

void TimerController::onConnectionChanged()
{
    const Connection::State state = connectionState();
    if (isConnected()) {
        if (!m_loaded) {
            m_loaded = true;
            fetchProjects();
        } else if (state == Connection::Connected && m_lastState != Connection::Connected) {
            // Back from a connectivity failure or a cooldown. The state
            // client reads the state itself.
            fetchProjects();
        }
    }
    m_lastState = state;
    Q_EMIT contextChanged();
    Q_EMIT statusChanged();
}

void TimerController::onGenerationChanged()
{
    reset();
}

void TimerController::reset()
{
    // Another generation, account or client: nothing carries over.
    m_epoch.advance();
    m_gate.reset();
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    m_catalog->reset();
    m_next->reset();
    setError(QString());
    m_lastState = connectionState();
    m_stopReply.reset();
    applyView();
    m_catalog->clearList();
    resolveProject();
    Q_EMIT contextChanged();
    Q_EMIT statusChanged();
}

void TimerController::setError(const QString &error)
{
    m_error = error;
    m_keepError = false;
}

void TimerController::clearKeptError()
{
    if (m_keepError) {
        setError(QString());
        Q_EMIT statusChanged();
    }
}

void TimerController::updateElapsed()
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
