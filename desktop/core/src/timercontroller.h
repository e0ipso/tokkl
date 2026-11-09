#pragma once

#include "epoch.h"
#include "timermodel.h"

#include <QVariant>

namespace Tokkl
{

// The timer for QML (TokklTimer) and the panels: the TimerModel it shows and
// the actions, one write at a time, tied to the connection's generation.
class TimerController : public TimerModel
{
    Q_OBJECT

    // Not owned. The connection is the client's.
    Q_PROPERTY(Tokkl::TimerStateClient *stateClient READ stateClient CONSTANT)

public:
    // Reads and acts through the given client, and runs on its clock. The
    // client is not owned and must outlive the controller.
    explicit TimerController(TimerStateClient &client, QObject *parent = nullptr);
    ~TimerController() override;

    // True when a request was sent. All but chooseProject() are refused
    // while a session is active; start() also while paused.
    Q_INVOKABLE bool start();
    // While paused, discards the chain.
    Q_INVOKABLE bool stop();
    Q_INVOKABLE bool pause();
    Q_INVOKABLE bool resume();
    // Pauses a running entry, resumes a paused chain, otherwise starts.
    Q_INVOKABLE bool toggle() override;
    // Null, 0 or an active project's id, while canChooseProject().
    Q_INVOKABLE bool chooseProject(const QVariant &projectId);
    // While an entry runs, also edits that entry's billable flag.
    Q_INVOKABLE bool chooseBillable(bool billable);

public Q_SLOTS:
    // A panel opens its menu: reads the projects when their revision moved.
    void refreshProjects();
    // Explicit reconnect: lifts a workspace block and revalidates the account.
    void reconnect();

Q_SIGNALS:
    // A write ended; message is why it failed, empty for a new generation.
    void writeFinished(bool ok, const QString &message);

private:
    void onConnectionChanged();
    void onStateChanged();
    void onSettlingChanged();
    void reset();
    void beginMutation();
    void refreshState();
    bool updateEntry(const TimeEntryUpdate &update);
    // start is true for a start or resume.
    void finishMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start = false);
    void endMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    // Clears a kept message on a user action.
    void clearKeptError();

    TimerStateClient &m_client;
    // Advanced by reset(); callbacks from an earlier epoch do nothing.
    Epoch m_epoch;
    Connection::State m_lastState = Connection::Unconfigured;
    // The data of the current context was requested once.
    bool m_loaded = false;
    // m_error is a refused start's or resume's message, or a 409's, which a
    // new state leaves in place.
    bool m_keepError = false;
    bool m_rediscoveryUsed = false;
};

}
