#include "timercontroller.h"

#include "logging.h"

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

// What the panel shows of a chain: whether it is paused, its seconds, the
// clone, and the project and billable flag of the menu.
bool sameChain(const std::optional<TimerPause> &a, const std::optional<TimerPause> &b)
{
    if (a.has_value() != b.has_value()) {
        return false;
    }
    return !a
        || (a->paused == b->paused && a->seconds == b->seconds && a->cloneEntryId == b->cloneEntryId && a->projectId == b->projectId
            && a->billable == b->billable);
}
}

TimerController::TimerController(QObject *parent)
    : TimerController(nullptr, parent)
{
    m_clock = new SystemClock(this);
    connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
}

TimerController::TimerController(Clock *clock, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
    , m_catalog(new ProjectCatalog(
          [this] {
              return !m_workspaceLost;
          },
          this))
{
    connect(m_catalog, &ProjectCatalog::listChanged, this, &TimerController::projectsChanged);
    connect(m_catalog, &ProjectCatalog::listLoaded, this, [this] {
        applyStopDefault();
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
    connect(this, &TimerController::selectionChanged, this, &TimerController::choiceChanged);
    connect(this, &TimerController::currentEntryChanged, this, &TimerController::choiceChanged);
    connect(this, &TimerController::chainChanged, this, &TimerController::choiceChanged);
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
        connect(m_connection, &Connection::nextStartChanged, this, &TimerController::selectionChanged);
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
    return m_mutating || (m_state && m_state->settling());
}

bool TimerController::canWrite() const
{
    return m_connection && m_connection->canWrite() && m_clock && m_state && !m_workspaceLost && m_view && !isBusy();
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
    return m_view ? Ready : Loading;
}

std::optional<TimeEntry> TimerController::currentEntry() const
{
    return m_entry;
}

QVariant TimerController::currentEntryVariant() const
{
    return m_entry ? QVariant(m_entry->toVariantMap()) : QVariant::fromValue(nullptr);
}

bool TimerController::isRunning() const
{
    return m_entry.has_value();
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
    return m_chain && m_chain->paused;
}

qint64 TimerController::chainSeconds() const
{
    return m_chain ? m_chain->seconds : 0;
}

bool TimerController::isSessionActive() const
{
    return m_sessionActive;
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
    return m_connection ? m_connection->nextProjectIdVariant() : QVariant::fromValue(nullptr);
}

void TimerController::setSelectedProjectId(const QVariant &projectId)
{
    if (m_connection) {
        pickNextStart();
        m_connection->setNextProjectIdVariant(projectId);
    }
}

bool TimerController::billable() const
{
    return m_connection && m_connection->nextBillable();
}

void TimerController::setBillable(bool billable)
{
    if (m_connection) {
        pickNextStart();
        m_connection->setNextBillable(billable);
    }
}

QVariant TimerController::chosenProjectId() const
{
    if (m_entry || isPaused()) {
        const std::optional<qint64> project = chosenProject();
        return project ? QVariant(*project) : QVariant::fromValue(nullptr);
    }
    return selectedProjectId();
}

bool TimerController::chosenBillable() const
{
    if (m_entry) {
        return m_entry->billable;
    }
    return isPaused() ? m_chain->billable : billable();
}

std::optional<Project> TimerController::entryProject() const
{
    return m_entryProject;
}

QVariant TimerController::entryProjectVariant() const
{
    return m_entryProject ? QVariant(m_entryProject->toVariantMap()) : QVariant::fromValue(nullptr);
}

TimerController::IndicatorState TimerController::indicatorState() const
{
    switch (m_indicator.state) {
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
    return m_indicator.color;
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
    if (!canWrite() || m_entry || isPaused() || m_sessionActive) {
        return false;
    }
    // A default that answers after the start must not replace its choice,
    // and a pick lasts only until this start.
    m_defaults.clear();
    StartEntry entry;
    entry.start = m_clock->now().toUTC();
    entry.projectId = m_connection->nextProjectId();
    entry.billable = m_connection->nextBillable();
    const qint64 revision = m_view->revision;
    beginMutation();

    m_connection->startEntry(entry, m_epoch.guard(this, [this, revision](const ApiResult<TimeEntry> &result) {
        if (result.ok() && !m_workspaceLost) {
            showReply(revision, result.value->isRunning() ? result.value : std::nullopt);
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, true, true);
    }));
    return true;
}

bool TimerController::stop()
{
    if (m_sessionActive) {
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
    if (!canWrite() || !m_entry) {
        return false;
    }
    const qint64 entryId = m_entry->id;
    const qint64 revision = m_view->revision;
    beginMutation();

    m_connection->stopEntry(entryId, m_epoch.guard(this, [this, entryId, revision](const ApiResult<TimeEntry> &result) {
        if (result.ok() && !m_workspaceLost && m_entry && m_entry->id == entryId) {
            // The reply names the project the server stopped, which another
            // client may have changed since the last state.
            showReply(revision, std::nullopt, result.value);
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

bool TimerController::pause()
{
    if (!canWrite() || !m_entry) {
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
    if (!canWrite() || m_entry || !isPaused()) {
        return false;
    }
    // As for a start: a default that answers later must not replace the
    // choice, and a pick lasts only until this start.
    m_defaults.clear();
    beginMutation();

    m_state->resume(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error, true);
    }));
    return true;
}

bool TimerController::toggle()
{
    if (m_sessionActive) {
        return false;
    }
    if (m_entry) {
        return pause();
    }
    return isPaused() ? resume() : start();
}

bool TimerController::chooseProject(const QVariant &projectId)
{
    // The project of a running or paused entry is fixed until it stops.
    if (!canWrite() || m_entry || isPaused()) {
        return false;
    }
    std::optional<qint64> project;
    bool billable = false;
    if (!projectId.isNull() && projectId.isValid()) {
        bool ok = false;
        const qint64 id = projectId.toLongLong(&ok);
        if (!ok || id < 0) {
            return false;
        }
        if (id > 0) {
            // Only an active project of this workspace is a choice; an
            // archived one stays on its entry until another is chosen.
            const std::optional<Project> found = m_catalog->activeProject(id);
            if (!found) {
                return false;
            }
            project = id;
            billable = found->billable;
        }
    }
    clearKeptError();
    pickNextStart();
    setNextStart(project, billable);
    return true;
}

bool TimerController::chooseBillable(bool billable)
{
    // A resume copies the chain's flag.
    if (!canWrite() || isPaused()) {
        return false;
    }
    clearKeptError();
    pickNextStart();
    m_connection->setNextBillable(billable);
    if (!m_entry || m_entry->billable == billable) {
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
    const qint64 entryId = m_entry->id;
    const qint64 revision = m_view->revision;
    beginMutation();

    m_connection->updateEntry(entryId, update, m_epoch.guard(this, [this, entryId, revision](const ApiResult<TimeEntry> &result) {
        if (result.ok() && !m_workspaceLost && m_entry && m_entry->id == entryId) {
            showReply(revision, result.value->isRunning() ? result.value : std::nullopt, result.value);
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

void TimerController::beginMutation()
{
    m_mutating = true;
    setError(QString());
    Q_EMIT statusChanged();
}

void TimerController::finishMutation(Outcome outcome, const ApiError &error, bool start, bool entryReply)
{
    m_mutating = false;
    if (outcome != Outcome::Applied) {
        qCInfo(lcTimer) << "Timer change ended with" << outcome << error.message;
    }
    if (outcome == Outcome::Unknown) {
        // The server may have acted. Busy until a read sent from now on
        // shows its state; never send the write again. The timer actions
        // have asked for it already.
        m_settleWhenDone = true;
    }
    if (std::exchange(m_settleWhenDone, false) && m_state && !m_state->settling()) {
        m_state->settle();
    } else if (outcome == Outcome::Applied && entryReply && m_state) {
        // The reply shows only the entry; read the rest.
        m_state->refresh();
    }
    if (m_workspaceLost) {
        Q_EMIT statusChanged();
        return;
    }

    switch (outcome) {
    case Outcome::Applied:
        setError(QString());
        break;
    case Outcome::Conflict:
        // The state the server sent instead is shown already.
        setError(tr("The timer changed on another device first."));
        m_keepError = true;
        break;
    case Outcome::Unknown:
        setError(error.message);
        break;
    case Outcome::Refused:
        switch (error.kind) {
        case ApiError::Kind::Forbidden:
            loseWorkspace(error);
            return;
        case ApiError::Kind::RateLimited:
        case ApiError::Kind::NotConnected:
        case ApiError::Kind::AuthenticationPaused:
            // Refused before the server acted. Reconnection or the end of the
            // cooldown reads the state again.
            setError(error.message);
            break;
        default:
            // Answered and refused, for example a 409 for an entry that was
            // already stopped. Read what the server has now. A refused start
            // or resume created nothing, so the read cannot answer it: its
            // message stays until the next action.
            setError(error.message);
            m_keepError = start;
            if (m_state) {
                m_state->refresh();
            }
            break;
        }
        break;
    }
    Q_EMIT statusChanged();
}

void TimerController::loseWorkspace(const ApiError &error)
{
    qCWarning(lcTimer) << "Workspace refused (403); writes blocked until reconnect:" << error.message;
    m_workspaceLost = true;
    // A write in flight keeps its lock until it answers, and the server
    // state stays unknown until a read after that answer.
    if (m_mutating) {
        m_settleWhenDone = true;
    }
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    m_catalog->forget();
    applyView();
    m_catalog->clearList();
    m_defaults.clear();
    if (m_connection) {
        m_connection->setNextProjectId(std::nullopt);
        m_connection->setNextBillable(false);
        // The account may have another workspace now. Ask once; a different
        // default workspace starts a new generation, which lifts the block.
        if (!m_rediscoveryUsed) {
            m_rediscoveryUsed = true;
            m_connection->fetchMe();
        }
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
    m_defaults.wantLastEntry();
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
    const std::optional<TimerState> state = m_state ? m_state->state() : std::nullopt;
    if (!state) {
        // A new generation, or no client.
        if (m_view) {
            m_view.reset();
            m_viewPatched = false;
            applyView();
            Q_EMIT statusChanged();
        }
        return;
    }
    if (m_view && m_viewPatched && state->revision <= m_view->revision) {
        return; // from before the write whose reply is shown
    }
    m_view = state;
    m_viewPatched = false;
    applyView();
    if (!isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    // The first state of a connection. A running entry sets the default
    // when it stops; otherwise ask for the last one.
    if (!m_sessionActive && m_defaults.takeLastEntryWanted() && !m_entry) {
        fetchLastEntry();
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

void TimerController::fetchLastEntry()
{
    if (m_defaults.picked() || !readable()) {
        return;
    }
    const quint64 number = m_defaults.beginLastEntryRead();

    // Known limit: the API lists only the entries of the last 9 days, so
    // after a longer break there is no last entry and the next start has no
    // project. The newest entry comes first.
    m_connection->fetchRecentEntries(m_epoch.guard(this, [this, number](const ApiResult<QList<ListedEntry>> &result) {
        if (!m_defaults.takeLastEntryRead(number)) {
            return; // a choice or start since it was sent
        }
        if (m_workspaceLost || m_defaults.picked() || m_entry) {
            return;
        }
        if (!result.ok()) {
            // Try again after the next state.
            m_defaults.wantLastEntry();
            return;
        }
        std::optional<qint64> project;
        bool billable = false;
        if (!result.value->isEmpty()) {
            const ListedEntry &last = result.value->first();
            if (last.entry.workspaceId == workspaceId() && last.entry.projectId && last.projectActive) {
                project = last.entry.projectId;
                billable = last.projectBillable;
            }
        }
        m_defaults.takeStopDefault();
        setNextStart(project, billable);
    }));
}

void TimerController::fetchProjects()
{
    if (readable()) {
        m_catalog->fetch(m_connection);
    }
}

void TimerController::showReply(qint64 revision, const std::optional<TimeEntry> &running, const std::optional<TimeEntry> &stoppedReply)
{
    if (!m_view || m_view->revision > revision) {
        return; // a newer state came, with this write or after it
    }
    m_view->runningEntry = running;
    const std::optional<qint64> runningId = running ? std::optional<qint64>(running->id) : std::nullopt;
    // As the server settles them: a chain stays only while its clone runs,
    // or paused while nothing runs, and a session only while its pomodoro
    // runs.
    if (m_view->pause && !(running ? m_view->pause->cloneEntryId == runningId : m_view->pause->paused)) {
        m_view->pause.reset();
    }
    if (m_view->pomodoro && m_view->pomodoro->entryId != runningId) {
        m_view->pomodoro.reset();
    }
    m_viewPatched = true;
    applyView(stoppedReply);
}

void TimerController::applyView(const std::optional<TimeEntry> &stoppedReply)
{
    std::optional<TimeEntry> next;
    std::optional<TimerPause> chain;
    const bool session = m_view && m_view->pomodoro;
    // A lost workspace hides what runs in it; the session's pomodoro is the
    // session's.
    if (m_view && !m_workspaceLost && !session) {
        next = m_view->runningEntry;
        if (next && next->workspaceId != workspaceId()) {
            // Running in another workspace: not shown in this context.
            next.reset();
        }
        chain = m_view->pause;
        if (chain && (chain->workspaceId != workspaceId() || !(next ? chain->cloneEntryId == next->id : chain->paused))) {
            chain.reset();
        }
    }
    const bool entryChanged = next != m_entry;
    const bool chainChanged = !sameChain(chain, m_chain);
    const bool sessionChanged = session != m_sessionActive;
    // A stop the state shows, not a context that went away.
    const bool stopped = m_entry.has_value() && !next.has_value() && m_view && !m_workspaceLost && !session;
    std::optional<qint64> stoppedProject;
    if (stopped) {
        if (stoppedReply && stoppedReply->id == m_entry->id) {
            stoppedProject = stoppedReply->projectId;
        } else {
            // A pause names the project the server stopped.
            stoppedProject = chain && chain->paused ? chain->projectId : m_entry->projectId;
        }
    }
    m_entry = next;
    m_chain = chain;
    m_sessionActive = session;
    if (next) {
        m_defaults.cancelLastEntryRead();
    }
    if (stopped) {
        // The next start defaults to the project of the entry that stopped,
        // when it is still an active project of the workspace. Without the
        // project list yet, the check waits for it. A pick made before this
        // stop no longer applies.
        m_defaults.stopped();
        if (stoppedProject && !m_catalog->listKnown()) {
            m_defaults.waitForList(*stoppedProject);
        } else {
            setStopDefault(stoppedProject);
        }
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

void TimerController::applyStopDefault()
{
    // Cleared by a pick, a start or a newer default since the stop.
    if (const std::optional<qint64> projectId = m_defaults.takeStopDefault()) {
        setStopDefault(projectId);
    }
}

void TimerController::setStopDefault(std::optional<qint64> projectId)
{
    const std::optional<Project> found = projectId ? m_catalog->activeProject(*projectId) : std::nullopt;
    if (found) {
        setNextStart(found->id, found->billable);
    } else {
        setNextStart(std::nullopt, false);
    }
}

void TimerController::setNextStart(std::optional<qint64> projectId, bool billable)
{
    if (!m_connection) {
        return;
    }
    // A last-entry read still in flight is older than this choice.
    m_defaults.cancelLastEntryRead();
    m_connection->setNextProjectId(projectId);
    m_connection->setNextBillable(billable);
}

void TimerController::pickNextStart()
{
    m_defaults.pick();
}

std::optional<qint64> TimerController::chosenProject() const
{
    if (m_entry) {
        return m_entry->projectId;
    }
    if (isPaused()) {
        return m_chain->projectId;
    }
    return m_connection ? m_connection->nextProjectId() : std::nullopt;
}

void TimerController::resolveProject()
{
    const std::optional<qint64> id = chosenProject();
    // A project outside the active list is read on its own. Until a newer
    // read answers, the indicator keeps what the last one found.
    if (id && readable() && m_catalog->needsLookUp(*id)) {
        m_catalog->lookUp(m_connection, *id, workspaceId(), [this](qint64 projectId) {
            return chosenProject() == projectId;
        });
    }
    const std::optional<qint64> entryId = m_entry || isPaused() ? id : std::nullopt;
    setEntryProject(entryId ? m_catalog->knownProject(*entryId) : std::nullopt);
    const ProjectCatalog::Indicator indicator = m_catalog->indicatorFor(id);
    if (indicator != m_indicator) {
        m_indicator = indicator;
        Q_EMIT indicatorChanged();
    }
}

void TimerController::setEntryProject(const std::optional<Project> &project)
{
    const bool changed = project != m_entryProject;
    m_entryProject = project;
    if (changed) {
        Q_EMIT entryProjectChanged();
    }
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
    m_mutating = false;
    m_settleWhenDone = false;
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    m_catalog->reset();
    m_defaults.reset();
    setError(QString());
    m_lastState = connectionState();
    m_view.reset();
    m_viewPatched = false;
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
        elapsed = m_chain->seconds;
    } else if (m_entry && m_state) {
        // m_chain is set only with this entry as its clone.
        elapsed = std::max<qint64>(0, m_entry->start.secsTo(m_state->serverNow())) + chainSeconds();
    }
    if (elapsed != m_elapsed) {
        m_elapsed = elapsed;
        Q_EMIT elapsedChanged();
    }
}

}
