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
#include <QVariant>

#include <optional>

namespace Tokkl
{

class ProjectLoader;

// The timer's actions and what keeps them safe: start, stop, pause, resume
// and the project and billable choices, the connection they act on, the
// settling of each write and the recovery from a lost workspace. It reads
// a TimerModel through its public interface and changes it only through
// the model's roles (TimerModelRoles), whose operations send the model's
// notifications; the
// model shows the result, owns the project catalog and the next start's
// selection, and applies the next-start defaults. The coordinator's
// ProjectLoader does the reads of projects and of the last entry. The
// model's canWrite() is what every action asks first. A Pomodoro session
// works with it through TimerActions.
//
// The timer state is the server's, from a TimerStateClient, and the
// connection is the client's. The client reads the state, follows its event
// stream, polls while the stream is down, and reads again on a wake and
// whenever the connection becomes Connected again. The projects have no
// stream: they are read when a context starts, after a connectivity loss,
// on a wake and a reconnect, and checked whenever a panel opens its menu
// (refreshProjects()).
//
// One mutation runs at a time; clicks while it runs are ignored. Start,
// stop, pause, resume and stop while paused are the server's timer actions,
// sent against the revision shown, and the client adopts the state they
// return. A 409 adopts the server's state, ends the action and leaves a
// message until the next user action, so a start never replaces one another
// device made first. The billable edit goes through the timer too and names
// the running entry, so a change elsewhere that leaves it running does not
// refuse it; it gets a 409 only once that entry stopped. Each start carries
// an Idempotency-Key of its own, and one whose outcome is unknown goes out
// once more with it after a short wait. A failure that leaves the outcome unknown (no answer,
// timeout, 5xx, unreadable answer) keeps the timer busy while the client
// settles it, until a read sent after the failure brings a state. Nothing
// else is ever sent again.
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
// that stopped, and of the newest entry the API lists when a connection
// starts or reconnect() runs with nothing running. Only an active project of the workspace counts.
//
// chooseProject() sets only the project of the next start and is refused
// while an entry runs, a chain is paused or a session is active: the
// project of a running entry is fixed, and changing it means stopping and
// starting a new entry. chooseBillable() is refused while paused or during
// a session. TimerModel::canChooseProject() and canChooseBillable() are
// the rule, and every menu shows what they allow. chooseBillable() sets the next
// start too and, while an entry runs, edits that entry in place with one
// write carrying only billable, so the entry is never split. Choosing a project
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
    // Reads model and changes it through roles, the same model's; it must
    // outlive the coordinator. Acts through client, the one the model reads,
    // on its connection and clock; the client is not owned.
    TimerCoordinator(TimerModel *model, const TimerModelRoles &roles, TimerStateClient &client, QObject *parent = nullptr);
    ~TimerCoordinator() override;

    TimerModel *model() const;
    TimerStateClient *stateClient() const;

    bool holdsEntry() const override;
    bool isBusy() const override;
    bool canStartNew() const override;
    // The project and billable flag the model shows as chosen.
    Selection selection() const override;
    PrimaryAction toggleAction() const override;

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
    // Null, 0 or an active project's id. Returns false when refused: not
    // TimerModel::canChooseProject(), or not an active project.
    bool chooseProject(const QVariant &projectId);
    // Refused unless TimerModel::canChooseBillable().
    bool chooseBillable(bool billable);

    // The user is about to see the projects, as when a panel opens its
    // menu, or the state client woke (TimerStateClient::woke()): reads the
    // catalog's revision, and the whole list only when the revision moved
    // since the list was read. Sends nothing while a read of them is on its
    // way or the workspace cannot be read. The state is not read again: the
    // state client follows it.
    void refreshProjects();
    // Explicit reconnect: lifts a workspace block, revalidates the account
    // and reads the state and the projects again.
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
    void reset();
    void beginMutation();
    void refreshState();
    bool updateEntry(const TimeEntryUpdate &update);
    // start is true for a start or resume.
    void finishMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start = false);
    void endMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    // Clears the message of a refused start or resume, or of a 409, on a
    // user action.
    void clearKeptError();

    TimerModel *m_model;
    TimerStateUpdates *m_state;
    NextStartSelection *m_selection;
    TimerCatalogUpdates *m_catalog;
    ProjectLoader *m_loader;
    TimerStateClient &m_client;

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
