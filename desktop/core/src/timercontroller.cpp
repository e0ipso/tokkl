#include "timercontroller.h"

#include <QRegularExpression>

#include <algorithm>
#include <cstdlib>
#include <utility>

namespace Tokkl
{

namespace
{
// A running entry whose start is this close to the one a resume sent is the
// clone it created. The start travels in whole seconds.
constexpr qint64 resumeMatchMs = 1000;

// The request failed without saying whether the server acted on it.
bool outcomeUnknown(const ApiError &error)
{
    switch (error.kind) {
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
    case ApiError::Kind::InvalidResponse:
        return true;
    default:
        return false;
    }
}
}

TimerController::TimerController(QObject *parent)
    : TimerController(nullptr, parent)
{
    m_clock = new SystemClock(this);
    connect(m_clock, &Clock::ticked, this, &TimerController::onTick);
    m_chainStore = new SettingsChainStore(nullptr, this);
}

TimerController::TimerController(Clock *clock, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
{
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

Connection *TimerController::connection() const
{
    return m_connection;
}

void TimerController::setConnection(Connection *connection)
{
    if (connection == m_connection) {
        return;
    }
    if (m_connection) {
        disconnect(m_connection, nullptr, this, nullptr);
    }
    m_connection = connection;
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
}

ChainStore *TimerController::chainStore() const
{
    return m_chainStore;
}

void TimerController::setChainStore(ChainStore *store)
{
    if (store == m_chainStore) {
        return;
    }
    m_chainStore = store;
    // Read the new store with the next current entry.
    m_chainChecked = false;
    m_resumeStart = QDateTime();
    if (m_chain) {
        m_chain.reset();
        Q_EMIT chainChanged();
        updateElapsed();
        resolveProject();
    }
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
    return m_entryStale || (m_connection && m_connection->isStale());
}

bool TimerController::workspaceAccessLost() const
{
    return m_workspaceLost;
}

bool TimerController::isBusy() const
{
    return m_mutating || m_reconciling;
}

bool TimerController::canWrite() const
{
    return m_connection && m_connection->canWrite() && m_clock && !m_workspaceLost && m_entryKnown && !isBusy();
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
    return m_entryKnown ? Ready : Loading;
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
    return m_chain && m_chain->isPaused();
}

qint64 TimerController::chainSeconds() const
{
    return m_chain ? m_chain->seconds : 0;
}

std::optional<PauseChain> TimerController::chain() const
{
    return m_chain;
}

QVariantList TimerController::projects() const
{
    QVariantList list;
    for (const Project &project : m_projects) {
        list.append(project.toVariantMap());
    }
    return list;
}

bool TimerController::projectsIncomplete() const
{
    return m_projectsIncomplete;
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
    return m_indicatorState;
}

QString TimerController::indicatorColor() const
{
    return m_indicatorColor;
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
    if (!canWrite() || m_entry || isPaused()) {
        return false;
    }
    // A default that answers after the start must not replace its choice,
    // and a pick lasts only until this start.
    m_lastEntryRead = 0;
    m_stopDefault.reset();
    m_nextStartPicked = false;
    StartEntry entry;
    entry.start = m_clock->now().toUTC();
    entry.projectId = m_connection->nextProjectId();
    entry.billable = m_connection->nextBillable();
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->startEntry(entry, [self, epoch](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost) {
            self->applyEntry(result.value->isRunning() ? result.value : std::nullopt);
        }
        self->finishMutation(result.error, result.ok(), true);
    });
    return true;
}

bool TimerController::stop()
{
    if (isPaused()) {
        // Nothing runs on the server; the chain only ends here.
        if (isBusy()) {
            return false;
        }
        setError(QString());
        setChain(std::nullopt);
        Q_EMIT statusChanged();
        return true;
    }
    if (!canWrite() || !m_entry) {
        return false;
    }
    const qint64 entryId = m_entry->id;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->stopEntry(entryId, [self, epoch, entryId](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId) {
            // The reply names the project the server stopped, which another
            // client may have changed since the last read.
            self->applyEntry(std::nullopt, result.value);
        }
        self->finishMutation(result.error, result.ok());
    });
    return true;
}

bool TimerController::pause()
{
    if (!canWrite() || !m_entry) {
        return false;
    }
    const qint64 entryId = m_entry->id;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->stopEntry(entryId, [self, epoch, entryId](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        const bool mine = !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId;
        if (result.ok() && mine) {
            self->setChain(self->pausedChain(entryId, *result.value));
            self->applyEntry(std::nullopt, result.value);
        } else if (!result.ok() && mine && outcomeUnknown(result.error)) {
            // The server may have stopped the entry; the reads after this
            // failure tell.
            self->m_unansweredPause = entryId;
        }
        self->finishMutation(result.error, result.ok());
    });
    return true;
}

bool TimerController::resume()
{
    if (!canWrite() || m_entry || !isPaused()) {
        return false;
    }
    // As for a start: a default that answers later must not replace the
    // choice, and a pick lasts only until this start.
    m_lastEntryRead = 0;
    m_stopDefault.reset();
    m_nextStartPicked = false;
    StartEntry entry;
    entry.start = m_clock->now().toUTC();
    entry.description = m_chain->description;
    entry.projectId = m_chain->projectId;
    entry.taskId = m_chain->taskId;
    entry.tags = m_chain->tags;
    // The paused entry's flag, not the project default the stop applied to
    // the next start.
    entry.billable = m_chain->billable;
    m_resumeStart = entry.start;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->startEntry(entry, [self, epoch](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost) {
            const bool running = result.value->isRunning();
            // The reply is the clone.
            self->m_resumeStart = running ? result.value->start : QDateTime();
            self->applyEntry(running ? result.value : std::nullopt);
        } else if (!result.ok() && !self->m_workspaceLost && !outcomeUnknown(result.error)) {
            // A refusal created no clone. After any other failure the server
            // may have created one, and the read after it tells.
            self->m_resumeStart = QDateTime();
        }
        self->finishMutation(result.error, result.ok(), true);
    });
    return true;
}

bool TimerController::toggle()
{
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
            const auto found = std::find_if(m_projects.cbegin(), m_projects.cend(), [id](const Project &candidate) {
                return candidate.id == id;
            });
            // Only an active project of this workspace is a choice; an
            // archived one stays on its entry until another is chosen.
            if (found == m_projects.cend() || !found->active) {
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
    // A resume copies the paused entry's flag.
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
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->updateEntry(entryId, update, [self, epoch, entryId](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId) {
            self->applyEntry(result.value->isRunning() ? result.value : std::nullopt, result.value);
        }
        self->finishMutation(result.error, result.ok());
    });
    return true;
}

void TimerController::beginMutation()
{
    m_mutating = true;
    // Reads issued so far may describe the state before this mutation.
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    setError(QString());
    Q_EMIT statusChanged();
}

void TimerController::finishMutation(const ApiError &error, bool succeeded, bool start)
{
    m_mutating = false;
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    if (m_workspaceLost) {
        Q_EMIT statusChanged();
        return;
    }
    if (succeeded) {
        setError(QString());
        fetchEntry();
        Q_EMIT statusChanged();
        return;
    }

    switch (error.kind) {
    case ApiError::Kind::Forbidden:
        loseWorkspace(error);
        return;
    case ApiError::Kind::RateLimited:
    case ApiError::Kind::NotConnected:
    case ApiError::Kind::AuthenticationPaused:
        // Refused before the server acted. Reconnection or the end of the
        // cooldown reads the entry again.
        setError(error.message);
        break;
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
    case ApiError::Kind::InvalidResponse:
        // The server may have acted. Stay busy until a read shows its state;
        // never send the mutation again.
        m_reconciling = true;
        setError(error.message);
        fetchEntry();
        break;
    default:
        // Answered and refused, for example a 409 for an entry that was
        // already stopped. Read what the server has now. A refused start or
        // resume created nothing, so the read cannot answer it: its message
        // stays until the next action.
        setError(error.message);
        m_keepError = start;
        fetchEntry();
        break;
    }
    Q_EMIT statusChanged();
}

void TimerController::loseWorkspace(const ApiError &error)
{
    m_workspaceLost = true;
    m_entryKnown = false;
    m_entryStale = false;
    // A start or stop in flight keeps its lock until it answers, and the
    // server state stays unknown until a read after that answer.
    if (m_mutating) {
        m_reconciling = true;
    }
    m_firstValidRead = m_readsIssued + 1;
    m_entryReadPending = 0;
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    m_lookedUp.reset();
    m_lookedUpGone = false;
    m_lookedUpStale = false;
    m_lookupsPending.clear();
    applyEntry(std::nullopt);
    m_projectsKnown = false;
    if (!m_projects.isEmpty() || m_projectsIncomplete) {
        m_projects.clear();
        m_projectsIncomplete = false;
        Q_EMIT projectsChanged();
    }
    m_nextStartPicked = false;
    m_stopDefault.reset();
    m_lastEntryRead = 0;
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
    fetchEntry();
    fetchProjects();
}

void TimerController::resumed()
{
    refresh();
}

void TimerController::reconnect()
{
    if (!m_connection) {
        return;
    }
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_lastEntryWanted = true;
    setError(QString());
    Q_EMIT statusChanged();
    m_connection->reconnect();
    if (isConnected()) {
        // The account stays bound through revalidation; no state change
        // would trigger the reload. The read also replaces an automatic
        // next-start default with the last entry's project.
        refresh();
    }
}

bool TimerController::readable() const
{
    return m_connection && m_connection->isConnected() && !m_workspaceLost && !m_connection->rateLimitedUntil().isValid();
}

void TimerController::fetchEntry()
{
    if (!readable() || m_mutating || m_entryReadPending != 0) {
        return;
    }
    const quint64 number = ++m_readsIssued;
    m_entryReadPending = number;
    if (m_clock) {
        m_nextPoll = m_clock->now().addMSecs(pollIntervalMs);
    }

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->fetchCurrentEntry([self, epoch, number](const ApiResult<std::optional<TimeEntry>> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (self->m_entryReadPending == number) {
            self->m_entryReadPending = 0;
        }
        if (number < self->m_firstValidRead || number <= self->m_lastAppliedRead || self->m_workspaceLost) {
            return; // overtaken by a mutation or a newer read
        }
        if (!result.ok()) {
            // After a transient failure the entry shown stays stale until a
            // current-entry read succeeds, even if other requests recover the
            // connection first. Refused credentials start a new generation
            // and never reach this point.
            if (result.error.isTransient()) {
                self->m_entryStale = true;
            }
            if (!result.error.isTransient() && result.error.kind != ApiError::Kind::RateLimited) {
                self->setError(result.error.message);
            }
            Q_EMIT self->statusChanged();
            return;
        }
        self->m_lastAppliedRead = number;
        self->m_entryKnown = true;
        self->m_entryStale = false;
        self->m_reconciling = false;
        if (!self->m_keepError) {
            self->setError(QString());
        }
        self->applyEntry(*result.value);
        if (self->m_lastEntryWanted) {
            // The first read of a connection. A running entry sets the
            // default when it stops; otherwise ask for the last one.
            self->m_lastEntryWanted = false;
            if (!self->m_entry) {
                self->fetchLastEntry();
            }
        }
        Q_EMIT self->statusChanged();
    });
}

void TimerController::fetchLastEntry()
{
    if (m_nextStartPicked || !readable()) {
        return;
    }
    const quint64 number = ++m_lastEntryReads;
    m_lastEntryRead = number;

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    // Known limit: the API lists only the entries of the last 9 days, so
    // after a longer break there is no last entry and the next start has no
    // project. The newest entry comes first.
    m_connection->fetchRecentEntries([self, epoch, number](const ApiResult<QList<ListedEntry>> &result) {
        if (!self || epoch != self->m_epoch || self->m_lastEntryRead != number) {
            return; // another context, or a choice or start since it was sent
        }
        self->m_lastEntryRead = 0;
        if (self->m_workspaceLost || self->m_nextStartPicked || self->m_entry) {
            return;
        }
        if (!result.ok()) {
            // Try again after the next current-entry read.
            self->m_lastEntryWanted = true;
            return;
        }
        std::optional<qint64> project;
        bool billable = false;
        if (!result.value->isEmpty()) {
            const ListedEntry &last = result.value->first();
            if (last.entry.workspaceId == self->workspaceId() && last.entry.projectId && last.projectActive) {
                project = last.entry.projectId;
                billable = last.projectBillable;
            }
        }
        self->m_stopDefault.reset();
        self->setNextStart(project, billable);
    });
}

void TimerController::fetchProjects()
{
    if (!readable() || m_projectsPending) {
        return;
    }
    m_projectsPending = true;

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->fetchProjects([self, epoch](const ApiResult<QList<Project>> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        self->m_projectsPending = false;
        if (self->m_workspaceLost) {
            return;
        }
        if (result.ok()) {
            self->m_projects = *result.value;
            self->m_projectsIncomplete = self->m_connection && self->m_connection->projectsIncomplete();
            self->m_projectsKnown = true;
            self->m_lookedUpStale = self->m_lookedUp.has_value();
            ++self->m_projectsRevision;
            Q_EMIT self->projectsChanged();
            self->applyStopDefault();
            self->resolveProject();
        } else if (result.error.kind == ApiError::Kind::Forbidden) {
            self->loseWorkspace(result.error);
        } else {
            Q_EMIT self->statusChanged();
        }
    });
}

void TimerController::applyEntry(const std::optional<TimeEntry> &entry, const std::optional<TimeEntry> &stoppedReply)
{
    // Any other running entry ends the chain, in whichever workspace it runs.
    followChain(entry);
    std::optional<TimeEntry> next = entry;
    if (next && next->workspaceId != workspaceId()) {
        // Running in another workspace: not shown in this context.
        next.reset();
    }
    const bool changed = next.has_value() != m_entry.has_value() || (next && next->toVariantMap() != m_entry->toVariantMap());
    const bool stopped = m_entry.has_value() && !next.has_value();
    std::optional<qint64> stoppedProject;
    if (stopped) {
        stoppedProject = stoppedReply && stoppedReply->id == m_entry->id ? stoppedReply->projectId : m_entry->projectId;
    }
    m_entry = next;
    if (next) {
        m_lastEntryRead = 0;
    }
    if (stopped && !m_workspaceLost) {
        // The next start defaults to the project of the entry that stopped,
        // when it is still an active project of the workspace. Without the
        // project list yet, the check waits for it. A pick made before this
        // stop no longer applies.
        m_nextStartPicked = false;
        m_stopDefault.reset();
        if (stoppedProject && !m_projectsKnown) {
            m_stopDefault = stoppedProject;
        } else {
            setStopDefault(stoppedProject);
        }
    }
    if (changed) {
        Q_EMIT currentEntryChanged();
    }
    updateElapsed();
    resolveProject();
}

void TimerController::followChain(const std::optional<TimeEntry> &entry)
{
    // A lost workspace hides the entry without saying what runs.
    if (m_workspaceLost || !m_connection || !m_connection->account()) {
        return;
    }
    if (!m_chainChecked) {
        m_chainChecked = true;
        std::optional<PauseChain> stored = m_chainStore ? m_chainStore->load() : std::nullopt;
        if (stored && stored->owner != chainOwner()) {
            // Another instance, account or workspace.
            stored.reset();
            m_chainStore->save(std::nullopt);
        }
        if (stored) {
            setChain(stored);
        }
    }
    const QDateTime resumeStart = std::exchange(m_resumeStart, QDateTime());
    if (m_unansweredPause) {
        if (!entry) {
            // The pause may have stopped the entry. The chain waits for the
            // account's entries.
            confirmPause();
            return;
        }
        // The entry still runs, so the stop never arrived, or another entry
        // runs. Either way no pause happened.
        m_unansweredPause.reset();
        m_pauseCheck = 0;
    }
    if (!m_chain) {
        return;
    }
    std::optional<PauseChain> chain = m_chain;
    if (chain->runningId) {
        // Stopped by another client, or replaced by another entry.
        if (!entry || entry->id != *chain->runningId) {
            chain.reset();
        }
    } else if (entry) {
        if (resumeStart.isValid() && entry->workspaceId == workspaceId() && std::abs(entry->start.msecsTo(resumeStart)) < resumeMatchMs) {
            chain->runningId = entry->id;
        } else {
            // Another entry started while paused.
            chain.reset();
        }
    }
    if (chain != m_chain) {
        setChain(chain);
    }
}

PauseChain TimerController::pausedChain(qint64 pausedId, const TimeEntry &stopped) const
{
    // The stopped entry as the server stored it: a resume copies it, and its
    // duration adds to the chain.
    PauseChain chain;
    if (m_chain && m_chain->runningId == pausedId) {
        chain.seconds = m_chain->seconds;
    }
    chain.owner = chainOwner();
    chain.seconds += stopped.isRunning() ? 0 : std::max<qint64>(0, stopped.duration);
    chain.description = stopped.description;
    chain.projectId = stopped.projectId;
    chain.taskId = stopped.taskId;
    chain.tags = stopped.tags;
    chain.billable = stopped.billable;
    return chain;
}

void TimerController::confirmPause()
{
    // Whether a click resumes or starts depends on the answer.
    m_reconciling = true;
    if (m_pauseCheck != 0 || !readable()) {
        return;
    }
    const quint64 number = ++m_pauseChecks;
    m_pauseCheck = number;

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    // Known limit: the API lists only the entries started in the last 9
    // days, so an older paused entry is not found and the chain ends.
    m_connection->fetchRecentEntries([self, epoch, number](const ApiResult<QList<ListedEntry>> &result) {
        if (!self || epoch != self->m_epoch || self->m_pauseCheck != number) {
            return; // another context, or a read showed a running entry since
        }
        self->m_pauseCheck = 0;
        if (self->m_workspaceLost || !self->m_unansweredPause) {
            return;
        }
        if (!result.ok()) {
            switch (result.error.kind) {
            case ApiError::Kind::Network:
            case ApiError::Kind::Timeout:
            case ApiError::Kind::Server:
            case ApiError::Kind::RateLimited:
            case ApiError::Kind::NotConnected:
            case ApiError::Kind::AuthenticationPaused:
                // No answer yet. The next current-entry read asks again.
                Q_EMIT self->statusChanged();
                return;
            default:
                break;
            }
        }
        const qint64 pausedId = *std::exchange(self->m_unansweredPause, std::nullopt);
        std::optional<TimeEntry> stopped;
        if (result.ok()) {
            for (const ListedEntry &listed : *result.value) {
                if (listed.entry.id == pausedId) {
                    stopped = listed.entry;
                    break;
                }
            }
        }
        self->m_reconciling = false;
        if (stopped && !stopped->isRunning()) {
            // As if the stop had answered.
            self->setChain(self->pausedChain(pausedId, *stopped));
        } else {
            // The paused entry is not listed as stopped, or the server
            // refused the list. It counts as a plain stop.
            self->setChain(std::nullopt);
        }
        Q_EMIT self->statusChanged();
    });
}

void TimerController::setChain(const std::optional<PauseChain> &chain)
{
    if (chain == m_chain) {
        return;
    }
    m_chain = chain;
    if (m_chainStore) {
        m_chainStore->save(chain);
    }
    Q_EMIT chainChanged();
    updateElapsed();
    resolveProject();
}

QString TimerController::chainOwner() const
{
    return m_connection ? m_connection->owner() : QString();
}

void TimerController::applyStopDefault()
{
    // Cleared by a pick, a start or a newer default since the stop.
    if (!m_stopDefault) {
        return;
    }
    const qint64 projectId = *m_stopDefault;
    m_stopDefault.reset();
    setStopDefault(projectId);
}

void TimerController::setStopDefault(std::optional<qint64> projectId)
{
    const auto found = std::find_if(m_projects.cbegin(), m_projects.cend(), [&projectId](const Project &candidate) {
        return projectId && candidate.id == *projectId;
    });
    if (found != m_projects.cend() && found->active) {
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
    m_lastEntryRead = 0;
    m_connection->setNextProjectId(projectId);
    m_connection->setNextBillable(billable);
}

void TimerController::pickNextStart()
{
    m_nextStartPicked = true;
    m_stopDefault.reset();
    m_lastEntryRead = 0;
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

std::optional<Project> TimerController::knownProject(qint64 id, bool *gone) const
{
    if (gone) {
        *gone = false;
    }
    for (const Project &project : m_projects) {
        if (project.id == id) {
            return project;
        }
    }
    if (m_lookedUp && m_lookedUp->id == id) {
        if (gone) {
            *gone = m_lookedUpGone;
        }
        return m_lookedUp;
    }
    return std::nullopt;
}

void TimerController::resolveProject()
{
    const std::optional<qint64> id = chosenProject();
    // Not among the active projects: read it once the active list is known,
    // so an archived project can still be named and a deleted one noticed.
    // A read from before the last project list is read again; until it
    // answers, the indicator keeps what that earlier read found.
    const bool listed = id && std::any_of(m_projects.cbegin(), m_projects.cend(), [&id](const Project &project) {
                            return project.id == *id;
                        });
    const bool stale = m_lookedUpStale && m_lookedUp && id && m_lookedUp->id == *id;
    if (id && !listed && (!knownProject(*id) || stale) && m_projectsKnown && !m_lookupsPending.contains(*id) && readable()) {
        m_lookupsPending.insert(*id);

        QPointer<TimerController> self(this);
        const quint64 epoch = m_epoch;
        const quint64 revision = m_projectsRevision;
        const qint64 projectId = *id;
        m_connection->fetchProject(projectId, [self, epoch, revision, projectId](const ApiResult<Project> &result) {
            if (!self || epoch != self->m_epoch) {
                return;
            }
            self->m_lookupsPending.remove(projectId);
            if (self->m_workspaceLost || self->chosenProject() != projectId) {
                return;
            }
            // Asked before the latest project list: show the answer for now
            // and read the project once more.
            const bool stale = revision != self->m_projectsRevision;
            if (result.ok()) {
                self->m_lookedUp = *result.value;
                self->m_lookedUpGone = false;
                self->m_lookedUpStale = stale;
            } else if (result.error.kind == ApiError::Kind::Forbidden) {
                self->loseWorkspace(result.error);
                return;
            } else if (result.error.status == 404) {
                // Deleted since it was chosen: keep the id, without a name.
                Project gone;
                gone.id = projectId;
                gone.workspaceId = self->workspaceId();
                gone.active = false;
                self->m_lookedUp = gone;
                self->m_lookedUpGone = true;
                self->m_lookedUpStale = stale;
            } else {
                return; // read again on the next resolve
            }
            self->resolveProject();
        });
    }
    const std::optional<qint64> entryId = m_entry || isPaused() ? chosenProject() : std::nullopt;
    setEntryProject(entryId ? knownProject(*entryId) : std::nullopt);
    updateIndicator();
}

void TimerController::updateIndicator()
{
    IndicatorState state = IndicatorState::None;
    QString color;
    if (const std::optional<qint64> id = chosenProject()) {
        bool gone = false;
        const std::optional<Project> project = knownProject(*id, &gone);
        if (!project) {
            state = IndicatorState::Pending;
        } else if (!gone) {
            state = IndicatorState::Project;
            // The rule of isHexColor in packages/common/colors.ts.
            static const QRegularExpression hex(QStringLiteral("^#[0-9a-f]{6}$"), QRegularExpression::CaseInsensitiveOption);
            if (hex.match(project->color).hasMatch()) {
                color = project->color.toLower();
            }
        }
    }
    if (state != m_indicatorState || color != m_indicatorColor) {
        m_indicatorState = state;
        m_indicatorColor = color;
        Q_EMIT indicatorChanged();
    }
}

void TimerController::setEntryProject(const std::optional<Project> &project)
{
    const bool changed = project.has_value() != m_entryProject.has_value() || (project && project->toVariantMap() != m_entryProject->toVariantMap());
    m_entryProject = project;
    if (changed) {
        Q_EMIT entryProjectChanged();
    }
}

// ----- clock and connection ------------------------------------------------

void TimerController::onTick()
{
    if (!m_clock) {
        return;
    }
    const QDateTime now = m_clock->now();
    const qint64 gap = m_lastTick.isValid() ? m_lastTick.msecsTo(now) : 0;
    m_lastTick = now;
    updateElapsed();
    if (gap > resumeGapMs || gap < -resumeGapMs) {
        resumed();
        return;
    }
    // A clock set back would otherwise postpone the poll.
    if (!m_nextPoll.isValid() || now >= m_nextPoll || now.msecsTo(m_nextPoll) > pollIntervalMs) {
        fetchEntry();
    }
}

void TimerController::onConnectionChanged()
{
    const Connection::State state = connectionState();
    if (isConnected()) {
        if (!m_loaded) {
            m_loaded = true;
            refresh();
        } else if (state == Connection::Connected && m_lastState != Connection::Connected) {
            // Back from a connectivity failure or a cooldown.
            refresh();
        }
    }
    m_lastState = state;
    Q_EMIT contextChanged();
    Q_EMIT statusChanged();
}

void TimerController::onGenerationChanged()
{
    // Another instance, account or secret, or a sign-out: the account's
    // chain ends. A stored chain not yet read for this context is kept, for
    // the account the connection binds at startup.
    if (m_chainChecked && m_chainStore) {
        m_chainStore->save(std::nullopt);
    }
    reset();
}

void TimerController::reset()
{
    // Another generation, account or connection: nothing carries over. The
    // stored chain stays; the next context reads it again.
    ++m_epoch;
    m_mutating = false;
    m_reconciling = false;
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    m_entryKnown = false;
    m_entryStale = false;
    m_firstValidRead = m_readsIssued + 1;
    m_lastAppliedRead = m_readsIssued;
    m_entryReadPending = 0;
    m_projectsPending = false;
    m_projectsKnown = false;
    m_lookedUp.reset();
    m_lookedUpGone = false;
    m_lookedUpStale = false;
    m_lookupsPending.clear();
    m_nextStartPicked = false;
    m_stopDefault.reset();
    m_lastEntryWanted = true;
    m_lastEntryRead = 0;
    m_nextPoll = QDateTime();
    setError(QString());
    m_lastState = connectionState();
    m_chainChecked = false;
    m_resumeStart = QDateTime();
    m_unansweredPause.reset();
    m_pauseCheck = 0;
    if (m_chain) {
        m_chain.reset();
        Q_EMIT chainChanged();
    }
    if (m_entry) {
        m_entry.reset();
        Q_EMIT currentEntryChanged();
    }
    updateElapsed();
    if (!m_projects.isEmpty() || m_projectsIncomplete) {
        m_projects.clear();
        m_projectsIncomplete = false;
        Q_EMIT projectsChanged();
    }
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
    } else if (m_entry && m_clock) {
        elapsed = std::max<qint64>(0, m_entry->start.secsTo(m_clock->now()));
        if (m_chain && m_chain->runningId == m_entry->id) {
            elapsed += m_chain->seconds;
        }
    }
    if (elapsed != m_elapsed) {
        m_elapsed = elapsed;
        Q_EMIT elapsedChanged();
    }
}

}
