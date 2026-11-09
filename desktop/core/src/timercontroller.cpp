#include "timercontroller.h"

#include "logging.h"

#include <utility>

namespace Tokkl
{

namespace
{
using Outcome = TimerActionResult::Outcome;
}

TimerController::TimerController(TimerStateClient &client, QObject *parent)
    : TimerModel(client, parent)
    , m_client(client)
{
    connect(this, &TimerModel::workspaceRefused, this, &TimerController::loseWorkspace);
    connect(&m_client, &TimerStateClient::stateChanged, this, &TimerController::onStateChanged);
    connect(&m_client, &TimerStateClient::settlingChanged, this, &TimerController::onSettlingChanged);
    // The projects have no stream, so a wake checks their revision.
    connect(&m_client, &TimerStateClient::woke, this, &TimerController::refreshProjects);
    Connection *connection = m_client.connection();
    connect(connection, &Connection::generationChanged, this, &TimerController::reset);
    connect(connection, &Connection::stateChanged, this, &TimerController::onConnectionChanged);
    connect(connection, &Connection::accountChanged, this, &TimerController::onConnectionChanged);
    reset();
    onConnectionChanged();
    // A state the client already holds.
    onStateChanged();
}

TimerController::~TimerController() = default;

// ----- connection lifetime -------------------------------------------------

void TimerController::onConnectionChanged()
{
    const Connection::State state = connectionState();
    // The first read of a context, or back from a connectivity failure or a
    // cooldown. The state client reads the state itself.
    if (isConnected() && (!m_loaded || (state == Connection::Connected && m_lastState != Connection::Connected))) {
        m_loaded = true;
        fetchProjects();
    }
    m_lastState = state;
    contextUpdated();
}

void TimerController::reset()
{
    // Another generation or account: nothing carries over, and the
    // answer to a write on its way never comes.
    const bool wasWriting = m_gate.running();
    m_epoch.advance();
    m_gate.reset();
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    setError(QString());
    m_lastState = connectionState();
    resetContext();
    if (wasWriting) {
        Q_EMIT writeFinished(false, QString());
    }
}

// ----- actions -------------------------------------------------------------

bool TimerController::start()
{
    if (!canStartNew()) {
        return false;
    }
    m_next->started();
    const NextStartSelection::Choice choice = m_next->choice();
    StartEntry entry;
    entry.start = m_client.clock().now().toUTC();
    entry.projectId = choice.projectId;
    entry.billable = choice.billable;
    beginMutation();

    m_client.start(entry, m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error, true);
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
        m_client.discard(m_epoch.guard(this, [this](const TimerActionResult &result) {
            finishMutation(result.outcome, result.error);
        }));
        return true;
    }
    if (!canWrite() || !isRunning()) {
        return false;
    }
    beginMutation();

    m_client.stop(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error);
    }));
    return true;
}

bool TimerController::pause()
{
    if (!canWrite() || !isRunning()) {
        return false;
    }
    beginMutation();

    m_client.pause(m_epoch.guard(this, [this](const TimerActionResult &result) {
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

    m_client.resume(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error, true);
    }));
    return true;
}

bool TimerController::toggle()
{
    if (isSessionActive()) {
        return false;
    }
    switch (toggleAction()) {
    case PrimaryAction::Pause:
        return pause();
    case PrimaryAction::Resume:
        return resume();
    default:
        return start();
    }
}

bool TimerController::chooseProject(const QVariant &projectId)
{
    if (!canChooseProject()) {
        return false;
    }
    const std::optional<NextStartSelection::Choice> choice = m_next->choiceFor(projectId);
    if (!choice) {
        return false;
    }
    clearKeptError();
    m_next->pick(*choice);
    return true;
}

bool TimerController::chooseBillable(bool billable)
{
    if (!canChooseBillable()) {
        return false;
    }
    clearKeptError();
    m_next->pickBillable(billable);
    const std::optional<TimeEntry> entry = currentEntry();
    if (!entry || entry->billable == billable) {
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
    const qint64 entryId = currentEntry()->id;
    beginMutation();
    m_client.edit(entryId, update, m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error);
    }));
    return true;
}

// ----- settling ------------------------------------------------------------

void TimerController::beginMutation()
{
    m_gate.begin();
    setError(QString());
    Q_EMIT statusChanged();
}

void TimerController::finishMutation(Outcome outcome, const ApiError &error, bool start)
{
    endMutation(outcome, error, start);
    const bool ok = outcome == Outcome::Applied;
    Q_EMIT writeFinished(ok, ok ? QString() : (m_error.isEmpty() ? error.message : m_error));
}

void TimerController::endMutation(Outcome outcome, const ApiError &error, bool start)
{
    if (outcome != Outcome::Applied) {
        qCInfo(lcTimer) << "Timer change ended with" << outcome << error.message;
    }
    const MutationGate::Ending ending = m_gate.finish(outcome, error, start);
    if (ending.settle && !m_client.settling()) {
        m_client.settle();
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
    if (ending.refresh) {
        m_client.refresh();
    }
    Q_EMIT statusChanged();
}

void TimerController::onStateChanged()
{
    // Without a state held (a new generation) the message stays.
    const bool held = heldState().has_value();
    if (held && !isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    showState();
    resolveChosenProject();
    if (held) {
        readLastEntryIfWanted();
    }
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

// ----- workspace access ----------------------------------------------------

void TimerController::loseWorkspace(const ApiError &error)
{
    qCWarning(lcTimer) << "Workspace refused (403); writes blocked until reconnect:" << error.message;
    m_workspaceLost = true;
    // A write in flight keeps its lock until it answers, and the server
    // state stays unknown until a read after that answer.
    m_gate.settleWhenDone();
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    forgetWorkspace();
    // The account may have another workspace now. Ask once; a different
    // default workspace starts a new generation, which lifts the block.
    if (!m_rediscoveryUsed) {
        m_rediscoveryUsed = true;
        m_client.connection()->fetchMe();
    }
}

// ----- reads ---------------------------------------------------------------

void TimerController::refreshProjects()
{
    fetchProjects();
}

void TimerController::refreshState()
{
    if (readable()) {
        m_client.refresh();
    }
}

void TimerController::reconnect()
{
    const bool wasLost = std::exchange(m_workspaceLost, false);
    m_rediscoveryUsed = false;
    m_next->wantLastEntry();
    setError(QString());
    if (wasLost) {
        // Shows the entry and chain of the state held again.
        showState();
        resolveChosenProject();
    } else {
        Q_EMIT statusChanged();
    }
    m_client.connection()->reconnect();
    if (isConnected()) {
        // The account stays bound through revalidation; no state change
        // would trigger the reload. The state that answers also replaces an
        // automatic next-start default with the last entry's project.
        refreshState();
        fetchProjects();
    }
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

}
