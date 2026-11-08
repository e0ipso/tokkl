#include "timercoordinator.h"

#include "logging.h"

#include <QCoreApplication>

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

// The messages keep the context they had when the controller held them, so
// a catalog made for it still applies.
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::TimerController", text);
}
}

TimerCoordinator::TimerCoordinator(TimerModel *model, Clock *clock, QObject *parent)
    : TimerActions(parent)
    , m_model(model)
    , m_fixedClock(clock)
    , m_clientClock(clock == nullptr)
{
    connect(m_model, &TimerModel::workspaceRefused, this, &TimerCoordinator::loseWorkspace);
    m_model->bind(nullptr, m_fixedClock);
    for (auto signal : {&TimerModel::contextChanged,
                        &TimerModel::statusChanged,
                        &TimerModel::currentEntryChanged,
                        &TimerModel::chainChanged,
                        &TimerModel::sessionActiveChanged,
                        &TimerModel::choiceChanged}) {
        connect(m_model, signal, this, &TimerActions::changed);
    }
}

TimerCoordinator::~TimerCoordinator() = default;

TimerModel *TimerCoordinator::model() const
{
    return m_model;
}

TimerStateClient *TimerCoordinator::stateClient() const
{
    return m_model->stateClient();
}

bool TimerCoordinator::holdsEntry() const
{
    return m_model->isRunning() || m_model->isPaused();
}

bool TimerCoordinator::isBusy() const
{
    return m_model->isBusy();
}

bool TimerCoordinator::canStartNew() const
{
    return m_model->canStartNew();
}

TimerActions::Selection TimerCoordinator::selection() const
{
    return {m_model->chosenProject(), m_model->chosenBillable()};
}

bool TimerCoordinator::writing() const
{
    return m_gate.running();
}

QString TimerCoordinator::message() const
{
    return m_error;
}

bool TimerCoordinator::workspaceLost() const
{
    return m_workspaceLost;
}

// ----- connection lifetime -------------------------------------------------

void TimerCoordinator::setStateClient(TimerStateClient *client)
{
    if (client == m_model->stateClient()) {
        return;
    }
    detach();
    m_model->bind(client, m_clientClock ? (client ? client->clock() : nullptr) : m_fixedClock.data());
    Connection *connection = m_model->connection();
    if (client) {
        connect(client, &TimerStateClient::stateChanged, this, &TimerCoordinator::onStateChanged);
        connect(client, &TimerStateClient::settlingChanged, this, &TimerCoordinator::onSettlingChanged);
        connect(client, &QObject::destroyed, this, [this] {
            detach();
            reset();
            Q_EMIT m_model->connectionChanged();
        });
    }
    if (connection) {
        connect(connection, &Connection::generationChanged, this, &TimerCoordinator::reset);
        connect(connection, &Connection::stateChanged, this, &TimerCoordinator::onConnectionChanged);
        connect(connection, &Connection::accountChanged, this, &TimerCoordinator::onConnectionChanged);
        connect(connection, &QObject::destroyed, this, &TimerCoordinator::reset);
    }
    reset();
    Q_EMIT m_model->connectionChanged();
    Q_EMIT m_model->selectionChanged();
    onConnectionChanged();
    // A state the client already holds.
    onStateChanged();
}

void TimerCoordinator::detach()
{
    if (TimerStateClient *client = m_model->stateClient()) {
        disconnect(client, nullptr, this, nullptr);
    }
    if (Connection *connection = m_model->connection()) {
        disconnect(connection, nullptr, this, nullptr);
    }
    // The clock stays until another client brings its own.
    m_model->bind(nullptr, m_model->clock());
}

void TimerCoordinator::onConnectionChanged()
{
    const Connection::State state = m_model->connectionState();
    if (m_model->isConnected()) {
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
    Q_EMIT m_model->contextChanged();
    Q_EMIT m_model->statusChanged();
}

void TimerCoordinator::reset()
{
    // Another generation, account or client: nothing carries over, and the
    // answer to a write on its way never comes.
    const bool wasWriting = m_gate.running();
    m_epoch.advance();
    m_gate.reset();
    m_workspaceLost = false;
    m_rediscoveryUsed = false;
    m_loaded = false;
    setError(QString());
    m_lastState = m_model->connectionState();
    m_model->resetContext();
    Q_EMIT m_model->contextChanged();
    Q_EMIT m_model->statusChanged();
    if (wasWriting) {
        Q_EMIT writeFinished(false, QString());
    }
}

// ----- actions -------------------------------------------------------------

bool TimerCoordinator::start()
{
    if (!m_model->canStartNew()) {
        return false;
    }
    m_model->startSent();
    const NextStartSelection::Choice choice = m_model->nextStart();
    StartEntry entry;
    entry.start = m_model->clock()->now().toUTC();
    entry.projectId = choice.projectId;
    entry.billable = choice.billable;
    beginMutation();

    m_model->connection()->startEntry(entry, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        finishMutation(outcomeOf(result.error, result.ok()), result.error, true, true);
    }));
    return true;
}

bool TimerCoordinator::stop()
{
    if (m_model->isSessionActive()) {
        return false;
    }
    if (m_model->isPaused()) {
        if (!m_model->canWrite()) {
            return false;
        }
        beginMutation();
        m_model->stateClient()->discard(m_epoch.guard(this, [this](const TimerActionResult &result) {
            finishMutation(result.outcome, result.error);
        }));
        return true;
    }
    if (!m_model->canWrite() || !m_model->isRunning()) {
        return false;
    }
    const qint64 entryId = m_model->currentEntry()->id;
    beginMutation();

    m_model->connection()->stopEntry(entryId, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        if (result.ok()) {
            m_model->entryEnded(*result.value);
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

bool TimerCoordinator::pause()
{
    if (!m_model->canWrite() || !m_model->isRunning()) {
        return false;
    }
    beginMutation();

    m_model->stateClient()->pause(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error);
    }));
    return true;
}

bool TimerCoordinator::resume()
{
    if (!m_model->canWrite() || m_model->isRunning() || !m_model->isPaused()) {
        return false;
    }
    m_model->startSent();
    beginMutation();

    m_model->stateClient()->resume(m_epoch.guard(this, [this](const TimerActionResult &result) {
        finishMutation(result.outcome, result.error, true);
    }));
    return true;
}

bool TimerCoordinator::toggle()
{
    if (m_model->isSessionActive()) {
        return false;
    }
    if (m_model->isRunning()) {
        return pause();
    }
    return m_model->isPaused() ? resume() : start();
}

bool TimerCoordinator::chooseProject(const QVariant &projectId)
{
    // The project of a running or paused entry is fixed until it stops.
    if (!m_model->canWrite() || m_model->isRunning() || m_model->isPaused()) {
        return false;
    }
    const std::optional<NextStartSelection::Choice> choice = m_model->choiceFor(projectId);
    if (!choice) {
        return false;
    }
    clearKeptError();
    m_model->pick(*choice);
    return true;
}

bool TimerCoordinator::chooseBillable(bool billable)
{
    // A resume copies the chain's flag.
    if (!m_model->canWrite() || m_model->isPaused()) {
        return false;
    }
    clearKeptError();
    m_model->pickBillable(billable);
    const std::optional<TimeEntry> entry = m_model->currentEntry();
    if (!entry || entry->billable == billable) {
        return true;
    }
    TimeEntryUpdate update;
    update.billable = billable;
    return updateEntry(update);
}

void TimerCoordinator::setSelectedProjectId(const QVariant &projectId)
{
    m_model->pickProjectId(projectId);
}

void TimerCoordinator::setBillable(bool billable)
{
    m_model->pickBillable(billable);
}

bool TimerCoordinator::updateEntry(const TimeEntryUpdate &update)
{
    // Only the fields in the update travel; the server keeps the entry's
    // start, description, tags and the rest, and it keeps running.
    const qint64 entryId = m_model->currentEntry()->id;
    beginMutation();

    m_model->connection()->updateEntry(entryId, update, m_epoch.guard(this, [this](const ApiResult<TimeEntry> &result) {
        // Stopped elsewhere before the edit: the reply names its project.
        if (result.ok() && !result.value->isRunning()) {
            m_model->entryEnded(*result.value);
        }
        finishMutation(outcomeOf(result.error, result.ok()), result.error, false, true);
    }));
    return true;
}

// ----- settling ------------------------------------------------------------

void TimerCoordinator::beginMutation()
{
    m_gate.begin();
    setError(QString());
    Q_EMIT m_model->statusChanged();
}

void TimerCoordinator::finishMutation(Outcome outcome, const ApiError &error, bool start, bool entryReply)
{
    endMutation(outcome, error, start, entryReply);
    const bool ok = outcome == Outcome::Applied;
    Q_EMIT writeFinished(ok, ok ? QString() : (m_error.isEmpty() ? error.message : m_error));
}

void TimerCoordinator::endMutation(Outcome outcome, const ApiError &error, bool start, bool entryReply)
{
    if (outcome != Outcome::Applied) {
        qCInfo(lcTimer) << "Timer change ended with" << outcome << error.message;
    }
    TimerStateClient *client = m_model->stateClient();
    const MutationGate::Ending ending = m_gate.finish(outcome, error, start, entryReply);
    if (ending.settle && client && !client->settling()) {
        client->settle();
    }
    if (m_workspaceLost) {
        Q_EMIT m_model->statusChanged();
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
    if (ending.refresh && client) {
        client->refresh();
    }
    Q_EMIT m_model->statusChanged();
}

void TimerCoordinator::onStateChanged()
{
    m_model->showState();
    if (!m_model->heldState()) {
        // A new generation, or no client.
        Q_EMIT m_model->statusChanged();
        return;
    }
    if (!m_model->isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    m_model->readLastEntryIfWanted();
    Q_EMIT m_model->statusChanged();
}

void TimerCoordinator::onSettlingChanged()
{
    // Settled by a read whose state may be older than the one held, so no
    // state change says so.
    if (!m_model->isBusy() && !m_keepError && !m_workspaceLost) {
        setError(QString());
    }
    Q_EMIT m_model->statusChanged();
}

// ----- workspace access ----------------------------------------------------

void TimerCoordinator::loseWorkspace(const ApiError &error)
{
    qCWarning(lcTimer) << "Workspace refused (403); writes blocked until reconnect:" << error.message;
    m_workspaceLost = true;
    // A write in flight keeps its lock until it answers, and the server
    // state stays unknown until a read after that answer.
    m_gate.settleWhenDone();
    m_error = tr("Tokkl cannot use this workspace any more (%1). Check your membership, then reconnect.").arg(error.message);
    m_model->forgetWorkspace();
    // The account may have another workspace now. Ask once; a different
    // default workspace starts a new generation, which lifts the block.
    Connection *connection = m_model->connection();
    if (connection && !m_rediscoveryUsed) {
        m_rediscoveryUsed = true;
        connection->fetchMe();
    }
    Q_EMIT m_model->statusChanged();
}

// ----- reads ---------------------------------------------------------------

void TimerCoordinator::refresh()
{
    TimerStateClient *client = m_model->stateClient();
    if (client && m_model->readable()) {
        client->refresh();
    }
    fetchProjects();
}

void TimerCoordinator::resumed()
{
    if (TimerStateClient *client = m_model->stateClient()) {
        client->resumed();
    }
    fetchProjects();
}

void TimerCoordinator::reconnect()
{
    Connection *connection = m_model->connection();
    if (!connection) {
        return;
    }
    const bool wasLost = std::exchange(m_workspaceLost, false);
    m_rediscoveryUsed = false;
    m_model->wantLastEntry();
    setError(QString());
    if (wasLost) {
        // Shows the entry and chain of the state held again.
        m_model->showState();
    }
    Q_EMIT m_model->statusChanged();
    connection->reconnect();
    if (m_model->isConnected()) {
        // The account stays bound through revalidation; no state change
        // would trigger the reload. The state that answers also replaces an
        // automatic next-start default with the last entry's project.
        refresh();
    }
}

void TimerCoordinator::fetchProjects()
{
    m_model->fetchProjects();
}

void TimerCoordinator::setError(const QString &error)
{
    m_error = error;
    m_keepError = false;
}

void TimerCoordinator::clearKeptError()
{
    if (m_keepError) {
        setError(QString());
        Q_EMIT m_model->statusChanged();
    }
}

}
