#include "timercontroller.h"

#include <QRegularExpression>

#include <algorithm>
#include <utility>

namespace Tokkl
{

namespace
{
using Outcome = TimerActionResult::Outcome;

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

Outcome outcomeOf(const ApiError &error, bool succeeded)
{
    if (succeeded) {
        return Outcome::Applied;
    }
    return outcomeUnknown(error) ? Outcome::Unknown : Outcome::Refused;
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

bool sameEntry(const std::optional<TimeEntry> &a, const std::optional<TimeEntry> &b)
{
    return a.has_value() == b.has_value() && (!a || a->toVariantMap() == b->toVariantMap());
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
    if (!canWrite() || m_entry || isPaused() || m_sessionActive) {
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
    const qint64 revision = m_view->revision;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->startEntry(entry, [self, epoch, revision](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost) {
            self->showReply(revision, result.value->isRunning() ? result.value : std::nullopt);
        }
        self->finishMutation(outcomeOf(result.error, result.ok()), result.error, true, true);
    });
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
        QPointer<TimerController> self(this);
        const quint64 epoch = m_epoch;
        m_state->discard([self, epoch](const TimerActionResult &result) {
            if (self && epoch == self->m_epoch) {
                self->finishMutation(result.outcome, result.error);
            }
        });
        return true;
    }
    if (!canWrite() || !m_entry) {
        return false;
    }
    const qint64 entryId = m_entry->id;
    const qint64 revision = m_view->revision;
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->stopEntry(entryId, [self, epoch, entryId, revision](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId) {
            // The reply names the project the server stopped, which another
            // client may have changed since the last state.
            self->showReply(revision, std::nullopt, result.value);
        }
        self->finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    });
    return true;
}

bool TimerController::pause()
{
    if (!canWrite() || !m_entry) {
        return false;
    }
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_state->pause([self, epoch](const TimerActionResult &result) {
        if (self && epoch == self->m_epoch) {
            self->finishMutation(result.outcome, result.error);
        }
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
    beginMutation();

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_state->resume([self, epoch](const TimerActionResult &result) {
        if (self && epoch == self->m_epoch) {
            self->finishMutation(result.outcome, result.error, true);
        }
    });
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

    QPointer<TimerController> self(this);
    const quint64 epoch = m_epoch;
    m_connection->updateEntry(entryId, update, [self, epoch, entryId, revision](const ApiResult<TimeEntry> &result) {
        if (!self || epoch != self->m_epoch) {
            return;
        }
        if (result.ok() && !self->m_workspaceLost && self->m_entry && self->m_entry->id == entryId) {
            self->showReply(revision, result.value->isRunning() ? result.value : std::nullopt, result.value);
        }
        self->finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    });
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
    m_workspaceLost = true;
    // A write in flight keeps its lock until it answers, and the server
    // state stays unknown until a read after that answer.
    if (m_mutating) {
        m_settleWhenDone = true;
    }
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    m_lookedUp.reset();
    m_lookedUpGone = false;
    m_lookedUpStale = false;
    m_lookupsPending.clear();
    applyView();
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
    m_lastEntryWanted = true;
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
    if (m_lastEntryWanted && !m_sessionActive) {
        // The first state of a connection. A running entry sets the default
        // when it stops; otherwise ask for the last one.
        m_lastEntryWanted = false;
        if (!m_entry) {
            fetchLastEntry();
        }
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
            // Try again after the next state.
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
    const bool entryChanged = !sameEntry(next, m_entry);
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
        m_lastEntryRead = 0;
    }
    if (stopped) {
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
    ++m_epoch;
    m_mutating = false;
    m_settleWhenDone = false;
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
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
    setError(QString());
    m_lastState = connectionState();
    m_view.reset();
    m_viewPatched = false;
    applyView();
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
