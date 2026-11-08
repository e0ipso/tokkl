#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "epoch.h"
#include "mutationgate.h"
#include "timeractions.h"
#include "timermodel.h"
#include "timerstateclient.h"

#include <QObject>
#include <QPointer>
#include <QVariant>

#include <optional>

namespace Tokkl
{

class ProjectLoader;

// The timer's actions and what keeps them safe: start, stop, pause, resume
// and the project and billable choices, the connection they act on, the
// settling of each write and the recovery from a lost workspace. It reads
// a TimerModel through its public interface and changes it only through
// TimerModelUpdates, whose operations send the model's notifications; the
// model shows the result, owns the project catalog and the next start's
// selection, and applies the next-start defaults. The coordinator's
// ProjectLoader does the reads of projects and of the last entry. The
// model's canWrite() is what every action asks first. A Pomodoro session
// works with it through TimerActions.
//
// The timer state is the server's, from a TimerStateClient, and the
// connection is the client's. The client reads the state, follows its event
// stream, polls while the stream is down, and reads again on a wake and
// whenever the connection becomes Connected again.
//
// One mutation runs at a time; clicks while it runs are ignored. Start,
// stop, pause, resume and stop while paused are the server's timer actions,
// sent against the revision shown (pause excepted), and the client adopts
// the state they return. A 409 adopts the server's state, ends the action
// and leaves a message until the next user action, so a start never
// replaces one another device made first. The billable edit, and a start or
// stop on a server without the app routes, are v9 calls whose reply is an
// entry, not the state: once one is applied the timer stays busy while the
// client settles, until a read sent after the reply brings the state that
// shows it. The billable edit stays a v9 PUT: the server has no edit
// against a revision. A failure that
// leaves the outcome unknown (no answer, timeout, 5xx, unreadable answer)
// keeps the timer busy while the client settles it the same way. No write
// is ever sent again.
//
// While the state holds a Pomodoro session, start(), stop(), pause(),
// resume() and toggle() do nothing.
//
// A 403 from a workspace operation may mean the account lost the workspace:
// the coordinator has the model hide the workspace's data, blocks writes and
// its workspace reads, and asks /me once whether the account now has
// another workspace. Only a new connection generation or reconnect() lifts
// the block. A write still in flight keeps the timer busy through the loss
// and any reconnect, until its reply arrives and a state read after it
// answers.
//
// The next start defaults to the project of the last entry: of the entry
// that stopped (as a v9 stop reply names it, when the panel stopped it), and
// of the newest entry the API lists when a connection starts or reconnect()
// runs with nothing running. Only an active project of the workspace counts.
//
// chooseProject() sets only the project of the next start and is refused
// while an entry runs: the project of a running entry is fixed, and changing
// it means stopping and starting a new entry. chooseBillable() sets the next
// start too and, while an entry runs, edits that entry in place with one PUT
// carrying only billable, so the entry is never split. Choosing a project
// applies its billable default (false for no project); a later billable
// choice overrides it.
//
// The server owns the pause chain. pause() asks it to stop the running entry
// and keep a chain: the stopped entry's description, project, task, tags and
// billable flag, and the seconds the server stored for the chain's entries.
// resume() asks it to start a clone, against the revision shown. While
// paused, the project and billable flag are the chain's and cannot be
// chosen, and stop() discards the chain, also against the revision shown. A
// refused resume leaves the chain paused. The server ends the chain on a
// stop of the clone, any other start or a discard, from any device, and the
// next state shows it.
//
// Everything is tied to the connection's generation. A new instance, account
// or secret clears the entry, projects, busy state and errors at once, and
// replies from the earlier generation never reach this object, even when the
// two accounts use the same numeric ids.
class TimerCoordinator : public TimerActions, public TimerActivity
{
    Q_OBJECT

public:
    // Reads model and changes it through updates, the same model's; it
    // must outlive the coordinator. A null clock follows the clock of the
    // state client it is given.
    TimerCoordinator(TimerModel *model, TimerModelUpdates *updates, Clock *clock, QObject *parent = nullptr);
    ~TimerCoordinator() override;

    TimerModel *model() const;

    // Not owned. Null leaves the timer without a connection.
    void setStateClient(TimerStateClient *client);
    TimerStateClient *stateClient() const;

    bool holdsEntry() const override;
    bool isBusy() const override;
    bool canStartNew() const override;
    // The project and billable flag the model shows as chosen.
    Selection selection() const override;

    bool writing() const override;
    QString message() const override;
    bool workspaceLost() const override;

    // The actions return true when a request was sent. All are refused
    // while a session is active.
    //
    // Starts a new entry; refused while paused.
    bool start();
    // Stops the running entry, which ends its chain. While paused it
    // discards the chain.
    bool stop();
    // Stops the running entry and keeps the chain paused.
    bool pause();
    // Starts a clone of the paused entry.
    bool resume();
    // Pauses a running entry, resumes a paused chain, otherwise starts.
    bool toggle() override;
    // Null, 0 or an active project's id. Returns false when refused: no
    // write possible now, an entry runs or a chain is paused, or not an
    // active project.
    bool chooseProject(const QVariant &projectId);
    // Refused while a chain is paused.
    bool chooseBillable(bool billable);
    // Sets the next start's choice as given, with no check and no write.
    void setSelectedProjectId(const QVariant &projectId);
    void setBillable(bool billable);

    // Reads the state and the projects again.
    void refresh();
    // The session woke from sleep: the state client reads the state and
    // replaces its stream, and the projects are read again. Not resume().
    void resumed();
    // Explicit reconnect: lifts a workspace block and revalidates the account.
    void reconnect();

Q_SIGNALS:
    // The write that start(), stop(), pause(), resume() or chooseBillable()
    // sent has ended. ok is true when the server applied it. Otherwise
    // message is why, as errorString() words it: a refusal, a 409, an
    // unknown outcome the state client now settles, or a lost workspace.
    // A new generation ends a write still on its way with an empty message.
    void writeFinished(bool ok, const QString &message);

private:
    void onConnectionChanged();
    void onStateChanged();
    void onSettlingChanged();
    void detach();
    void reset();
    void beginMutation();
    void fetchProjects();
    bool updateEntry(const TimeEntryUpdate &update);
    // start is true for a start or resume, and entryReply for a write that
    // went to v9, whose reply is an entry rather than the whole state, so
    // the state that shows it comes from a read.
    void finishMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start = false, bool entryReply = false);
    void endMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start, bool entryReply);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    // Clears the message of a refused start or resume, or of a 409, on a
    // user action.
    void clearKeptError();

    TimerModel *m_model;
    TimerModelUpdates *m_updates;
    ProjectLoader *m_loader;
    // The clock given, or the state client's when none was.
    QPointer<Clock> m_fixedClock;
    bool m_clientClock;

    // Advanced by reset(); callbacks from an earlier epoch do nothing.
    Epoch m_epoch;
    Connection::State m_lastState = Connection::Unconfigured;
    // The data of the current context was requested once.
    bool m_loaded = false;

    QString m_error;

    // The write that runs, and the settling a lost workspace asks of it.
    MutationGate m_gate;
    // m_error is a refused start's or resume's message, or a 409's, which a
    // new state leaves in place.
    bool m_keepError = false;
    bool m_workspaceLost = false;
    bool m_rediscoveryUsed = false;
};

}
