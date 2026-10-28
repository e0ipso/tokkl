#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "timerstateclient.h"

#include <QObject>
#include <QPointer>
#include <QSet>
#include <QVariant>

#include <optional>

namespace Tokkl
{

// The timer for QML: the running entry of the connection's validated
// account and workspace, its elapsed time, the project and billable choices
// for the next start, and start, stop, pause and resume actions.
//
// The timer state is the server's, from a TimerStateClient, and the
// connection is the client's. The client reads the state, follows its event
// stream, polls while the stream is down, and reads again on a wake and
// whenever the connection becomes Connected again. The running entry, the
// pause chain and the Pomodoro session all come from that state. Elapsed time
// is recomputed on every clock tick from the entry's server start and the
// client's server time, so a sleep, a late tick or a skewed clock loses
// nothing.
//
// One mutation runs at a time; clicks while it runs are ignored. Start, stop
// and the billable edit are v9 calls. Their reply shows at once, and a state
// no newer than the one held when the call went out cannot replace it.
// Pause, resume and stop while paused are the server's timer actions, and
// the state they return is adopted. A 409 adopts the server's state, ends the
// action and leaves a message until the next user action. A failure that
// leaves the outcome unknown (no answer, timeout, 5xx, unreadable answer)
// keeps the controller busy while the client settles it: until a read sent
// after the failure brings a state. No write is ever sent again.
//
// While the state holds a Pomodoro session, its open pomodoro is the running
// entry and belongs to the session: running and paused are false,
// sessionActive is true, and start(), stop(), pause(), resume() and toggle()
// do nothing.
//
// A 403 from a workspace operation may mean the account lost the workspace:
// the controller clears the workspace data it exposes, blocks writes and its
// workspace reads, and asks /me once whether the account now has another
// workspace. Only a new connection generation or reconnect() lifts the block.
// A write still in flight keeps the controller busy through the loss and any
// reconnect, until its reply arrives and a state read after it answers.
//
// The next start defaults to the project of the last entry: of the entry
// that stopped, after every stop (as the stop reply names it, when the panel
// stopped it), and of the newest entry the API lists when a connection starts
// or reconnect() runs with nothing running. Only an active project of the
// workspace counts; otherwise it is no project. A stop seen before the
// project list waits for it. A pick made while stopped wins until the next
// start; a reconnect replaces only an automatic default.
//
// The panel menu edits the choices through chooseProject() and
// chooseBillable(). chooseProject() sets only the project of the next start
// and is refused while an entry runs: the project of a running entry is fixed,
// and changing it means stopping and starting a new entry. chooseBillable()
// sets the next start too and, while an entry runs, edits that entry in place
// with one PUT carrying only billable, so the entry is never split. Choosing a
// project applies its billable default (false for no project); a later
// billable choice overrides it.
//
// The server owns the pause chain. pause() asks it to stop the running entry
// and keep a chain: the stopped entry's description, project, task, tags and
// billable flag, and the seconds the server stored for the chain's entries.
// resume() asks it to start a clone, against the revision shown. Elapsed time
// is the chain total: those seconds plus the running clone's time, frozen
// while paused. While paused, the project and billable flag are the chain's
// and cannot be chosen, and stop() discards the chain, also against the
// revision shown. A refused resume leaves the chain paused. The server ends
// the chain on a stop of the clone, any other start or a discard, from any
// device, and the next state shows it. A chain or entry in another workspace
// is not shown.
//
// Everything is tied to the connection's generation. A new instance, account
// or secret clears the entry, projects, busy state and errors at once, and
// replies from the earlier generation never reach this object, even when the
// two accounts use the same numeric ids.
class TimerController : public QObject
{
    Q_OBJECT

public:
    // One summary of the context for the panel. Ready is a validated account
    // whose current entry is known and nothing waits or failed.
    enum Status {
        Unconfigured, // no instance URL or no stored secret
        Loading, // reading the secret, validating, or the first state read
        Ready,
        Busy, // a write is in flight or its outcome is unknown
        Stale, // the data shown is the last known; the instance is unreachable
        AuthenticationBlocked, // the instance refused the credentials
        Error, // settings, wallet, workspace, rate limit or another failure; see errorString
    };
    Q_ENUM(Status)

    // What the panel indicator can show for chosenProjectId.
    enum class IndicatorState {
        None, // no project, or the instance no longer has it (404)
        Pending, // the project's details are still being read
        Project, // the project is known, archived or not
    };
    Q_ENUM(IndicatorState)

private:
    // Not owned. The connection is the client's.
    Q_PROPERTY(Tokkl::TimerStateClient *stateClient READ stateClient WRITE setStateClient NOTIFY connectionChanged)
    Q_PROPERTY(Tokkl::Connection *connection READ connection NOTIFY connectionChanged)

    // The validated context.
    Q_PROPERTY(bool connected READ isConnected NOTIFY contextChanged)
    Q_PROPERTY(QVariantMap account READ account NOTIFY contextChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY contextChanged)
    Q_PROPERTY(Tokkl::Connection::State connectionState READ connectionState NOTIFY statusChanged)
    // Shown data is the last known: the latest request failed transiently.
    Q_PROPERTY(bool stale READ isStale NOTIFY statusChanged)
    // A workspace operation answered 403; writes stay blocked until a new
    // generation or reconnect().
    Q_PROPERTY(bool workspaceAccessLost READ workspaceAccessLost NOTIFY statusChanged)
    Q_PROPERTY(bool busy READ isBusy NOTIFY statusChanged)
    // start() or stop() would send a request now. False until the state of
    // the context has been read.
    Q_PROPERTY(bool canWrite READ canWrite NOTIFY statusChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY statusChanged)
    Q_PROPERTY(Status status READ status NOTIFY statusChanged)

    Q_PROPERTY(QVariant currentEntry READ currentEntryVariant NOTIFY currentEntryChanged)
    Q_PROPERTY(bool running READ isRunning NOTIFY currentEntryChanged)
    // The chain total while a chain runs or is paused.
    Q_PROPERTY(qint64 elapsedSeconds READ elapsedSeconds NOTIFY elapsedChanged)
    // elapsedSeconds as H:MM in whole minutes; 0:00 when no chain is paused
    // and nothing runs.
    Q_PROPERTY(QString elapsedText READ elapsedText NOTIFY elapsedChanged)

    // A chain is paused: nothing runs, and resume() would start its clone.
    Q_PROPERTY(bool paused READ isPaused NOTIFY chainChanged)
    // The seconds the server stored for the chain's stopped entries; 0
    // without a chain.
    Q_PROPERTY(qint64 chainSeconds READ chainSeconds NOTIFY chainChanged)
    // The state holds a Pomodoro session, started on any device. Its open
    // pomodoro is the running entry, which running and currentEntry leave
    // out.
    Q_PROPERTY(bool sessionActive READ isSessionActive NOTIFY sessionActiveChanged)

    Q_PROPERTY(QVariantList projects READ projects NOTIFY projectsChanged)
    // The connection could not read every active project: projects is a
    // prefix of them. Cleared with the projects.
    Q_PROPERTY(bool projectsIncomplete READ projectsIncomplete NOTIFY projectsChanged)
    // Choices for the next start, kept by the connection for its account:
    // null or a project id, and the billable flag.
    Q_PROPERTY(QVariant selectedProjectId READ selectedProjectId WRITE setSelectedProjectId NOTIFY selectionChanged)
    Q_PROPERTY(bool billable READ billable WRITE setBillable NOTIFY selectionChanged)

    // What the menu shows: the running or paused entry's project and
    // billable flag, or the choices for the next start when nothing runs.
    Q_PROPERTY(QVariant chosenProjectId READ chosenProjectId NOTIFY choiceChanged)
    Q_PROPERTY(bool chosenBillable READ chosenBillable NOTIFY choiceChanged)
    // The running or paused entry's project as a project map, also when it is
    // archived and so missing from projects; null without one or while
    // unresolved. A project the instance no longer has is a map with an
    // empty name.
    Q_PROPERTY(QVariant entryProject READ entryProjectVariant NOTIFY entryProjectChanged)
    // The project behind chosenProjectId for the panel indicator, and its
    // colour as lowercase #rrggbb. The colour is empty outside the Project
    // state and for any other value. A string keeps the core free of Qt Gui.
    Q_PROPERTY(IndicatorState indicatorState READ indicatorState NOTIFY indicatorChanged)
    Q_PROPERTY(QString indicatorColor READ indicatorColor NOTIFY indicatorChanged)

public:
    // Uses the system clock.
    explicit TimerController(QObject *parent = nullptr);
    // Uses the given clock, which the controller does not own.
    explicit TimerController(Clock *clock, QObject *parent = nullptr);
    ~TimerController() override;

    TimerStateClient *stateClient() const;
    // The controller does not own the client. Null leaves it without a
    // connection.
    void setStateClient(TimerStateClient *client);
    Connection *connection() const;

    bool isConnected() const;
    QVariantMap account() const;
    qint64 workspaceId() const;
    Connection::State connectionState() const;
    bool isStale() const;
    bool workspaceAccessLost() const;
    bool isBusy() const;
    bool canWrite() const;
    QString errorString() const;
    Status status() const;

    std::optional<TimeEntry> currentEntry() const;
    QVariant currentEntryVariant() const;
    bool isRunning() const;
    qint64 elapsedSeconds() const;
    QString elapsedText() const;
    bool isPaused() const;
    qint64 chainSeconds() const;
    bool isSessionActive() const;

    QVariantList projects() const;
    bool projectsIncomplete() const;
    QVariant selectedProjectId() const;
    void setSelectedProjectId(const QVariant &projectId);
    bool billable() const;
    void setBillable(bool billable);
    QVariant chosenProjectId() const;
    bool chosenBillable() const;
    std::optional<Project> entryProject() const;
    QVariant entryProjectVariant() const;
    IndicatorState indicatorState() const;
    QString indicatorColor() const;

    static QString formatElapsed(qint64 seconds);

    // The actions return true when a request was sent. All are refused
    // while a session is active.
    //
    // Starts a new entry; refused while paused.
    Q_INVOKABLE bool start();
    // Stops the running entry, which ends its chain. While paused it
    // discards the chain.
    Q_INVOKABLE bool stop();
    // Stops the running entry and keeps the chain paused.
    Q_INVOKABLE bool pause();
    // Starts a clone of the paused entry.
    Q_INVOKABLE bool resume();
    // Pauses a running entry, resumes a paused chain, otherwise starts.
    Q_INVOKABLE bool toggle();
    // Null, 0 or an active project's id. Returns false when refused: no
    // write possible now, an entry runs or a chain is paused, or not an
    // active project.
    Q_INVOKABLE bool chooseProject(const QVariant &projectId);
    // Refused while a chain is paused.
    Q_INVOKABLE bool chooseBillable(bool billable);

public Q_SLOTS:
    // Reads the state and the projects again.
    void refresh();
    // The session woke from sleep: the state client reads the state and
    // replaces its stream, and the projects are read again. Not resume().
    void resumed();
    // Explicit reconnect: lifts a workspace block and revalidates the account.
    void reconnect();

Q_SIGNALS:
    void connectionChanged();
    void contextChanged();
    void statusChanged();
    void currentEntryChanged();
    void elapsedChanged();
    void chainChanged();
    void sessionActiveChanged();
    void projectsChanged();
    void selectionChanged();
    void choiceChanged();
    void entryProjectChanged();
    void indicatorChanged();

private:
    void onTick();
    void onConnectionChanged();
    void onGenerationChanged();
    void onStateChanged();
    void onSettlingChanged();
    void detach();
    void reset();
    void beginMutation();
    void fetchProjects();
    void fetchLastEntry();
    // Shows the reply of a v9 write sent at revision as the running entry,
    // ending the chain and the session it leaves no place for, unless a
    // newer state has come since. A state no newer than the one shown then
    // cannot replace it.
    void showReply(qint64 revision, const std::optional<TimeEntry> &running, const std::optional<TimeEntry> &stoppedReply = std::nullopt);
    // Derives the entry, chain and session shown from the state held.
    // stoppedReply is the server's answer to a stop or edit that ended the
    // entry; its project wins over the one last shown.
    void applyView(const std::optional<TimeEntry> &stoppedReply = std::nullopt);
    void applyStopDefault();
    void setStopDefault(std::optional<qint64> projectId);
    void setNextStart(std::optional<qint64> projectId, bool billable);
    void pickNextStart();
    bool updateEntry(const TimeEntryUpdate &update);
    std::optional<qint64> chosenProject() const;
    // The details of a project: from projects, else from the single-project
    // read. gone is set when that read answered 404.
    std::optional<Project> knownProject(qint64 id, bool *gone = nullptr) const;
    // Reads the chosen project when projects lacks it, then updates
    // entryProject and the indicator.
    void resolveProject();
    void setEntryProject(const std::optional<Project> &project);
    void updateIndicator();
    // start is true for a start or resume, and entryReply for a v9 write,
    // whose reply is an entry rather than the whole state.
    void finishMutation(TimerActionResult::Outcome outcome, const ApiError &error, bool start = false, bool entryReply = false);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    // Clears the message of a refused start or resume, or of a 409, on a
    // user action.
    void clearKeptError();
    void updateElapsed();
    bool readable() const;

    QPointer<Clock> m_clock;
    QPointer<TimerStateClient> m_state;
    QPointer<Connection> m_connection;

    // Bumped by reset(); callbacks from an earlier epoch do nothing.
    quint64 m_epoch = 0;
    Connection::State m_lastState = Connection::Unconfigured;
    // The data of the current context was requested once.
    bool m_loaded = false;

    // The state shown: the client's latest, or a v9 reply on top of an
    // older one (m_viewPatched), which only a newer revision replaces.
    std::optional<TimerState> m_view;
    bool m_viewPatched = false;
    std::optional<TimeEntry> m_entry;
    // The pause chain shown: paused, or with m_entry as its clone.
    std::optional<TimerPause> m_chain;
    bool m_sessionActive = false;
    QList<Project> m_projects;
    bool m_projectsIncomplete = false;
    // The project list of this context was read at least once.
    bool m_projectsKnown = false;
    std::optional<Project> m_entryProject;
    // The last project read on its own, because projects lacked it, and
    // whether the instance answered 404 for it.
    std::optional<Project> m_lookedUp;
    bool m_lookedUpGone = false;
    // The project list was read again after m_lookedUp, so it is read again
    // too: it may have been renamed, recoloured or deleted since.
    bool m_lookedUpStale = false;
    // Counts the project lists read. A single-project read that answers
    // after a newer list may predate a change that list saw, so its answer
    // stays stale and is read once more.
    quint64 m_projectsRevision = 0;
    QSet<qint64> m_lookupsPending; // ids of the project reads in flight
    IndicatorState m_indicatorState = IndicatorState::None;
    QString m_indicatorColor;
    qint64 m_elapsed = 0;
    QString m_error;

    bool m_mutating = false;
    // The workspace was lost while a write ran: once it answers, the state
    // is read before writes return.
    bool m_settleWhenDone = false;
    // m_error is a refused start's or resume's message, or a 409's, which a
    // new state leaves in place.
    bool m_keepError = false;
    bool m_workspaceLost = false;
    bool m_rediscoveryUsed = false;
    bool m_projectsPending = false;

    // The user picked the next-start choice since the last start or stop, so
    // no automatic default replaces it. Defaults themselves do not set it.
    bool m_nextStartPicked = false;
    // The project of an entry that stopped before the project list could
    // tell whether it is active; applied when the list arrives.
    std::optional<qint64> m_stopDefault;
    // Ask for the last entry's project after the next state.
    bool m_lastEntryWanted = false;
    quint64 m_lastEntryReads = 0;
    quint64 m_lastEntryRead = 0; // number of the last-entry read that may apply, or 0
};

}
