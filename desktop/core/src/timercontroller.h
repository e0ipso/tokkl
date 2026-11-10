#pragma once

#include "epoch.h"
#include "timermodel.h"

#include <QVariant>

namespace Tokkl
{

// One write at a time, tied to the connection's generation.
class TimerController : public TimerModel
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::TimerStateClient *stateClient READ stateClient CONSTANT)

public:
    // The client must outlive the controller.
    explicit TimerController(TimerStateClient &client, QObject *parent = nullptr);
    ~TimerController() override;

    // True when a request was sent. All but chooseProject() are refused while a
    // session is active; start() also while paused.
    Q_INVOKABLE bool start();
    // While paused, discards the chain.
    Q_INVOKABLE bool stop();
    Q_INVOKABLE bool pause();
    Q_INVOKABLE bool resume();
    Q_INVOKABLE bool toggle() override;
    Q_INVOKABLE bool chooseProject(const QVariant &projectId);
    // While an entry runs, also edits that entry.
    Q_INVOKABLE bool chooseBillable(bool billable);

public Q_SLOTS:
    // Reads the projects only when their revision moved.
    void refreshProjects();
    // Also lifts a workspace block.
    void reconnect();

Q_SIGNALS:
    // message is empty for a new generation.
    void writeFinished(bool ok, const QString &message);

private:
    void onConnectionChanged();
    void onStateChanged();
    void onSettlingChanged();
    void reset();
    void beginMutation();
    void refreshState();
    bool updateEntry(const TimeEntryUpdate &update);
    void finishMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start = false);
    void endMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    void clearKeptError();

    TimerStateClient &m_client;
    Epoch m_epoch;
    Connection::State m_lastState = Connection::Unconfigured;
    bool m_loaded = false;
    // A refused start's or resume's message, or a 409's, which a new state
    // leaves in place.
    bool m_keepError = false;
    bool m_rediscoveryUsed = false;
};

}
