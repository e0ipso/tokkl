#pragma once

#include "apitypes.h"
#include "chainstore.h"
#include "clock.h"
#include "connection.h"

#include <QDateTime>
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
// Elapsed time is recomputed from the entry's server start time on every
// clock tick, so a sleep or a late tick loses nothing. The current entry is
// polled every 30 seconds and read again after every action, after a resume
// (a tick that arrives far too late) and whenever the connection becomes
// Connected again.
//
// One mutation runs at a time; clicks while it runs are ignored. Reads issued
// before a mutation cannot overwrite what it returned. A failure that leaves
// the server state unknown (no answer, timeout, 5xx, unreadable answer) keeps
// the controller busy until a read reconciles it; a start is never replayed.
//
// A 403 from a workspace operation may mean the account lost the workspace:
// the controller clears the workspace data it exposes, blocks writes and
// polling, and asks /me once whether the account now has another workspace.
// Only a new connection generation or reconnect() lifts the block. A start or
// stop still in flight keeps the controller busy through the loss and any
// reconnect, until its reply arrives and a read reconciles the state.
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
// pause() stops the running entry and keeps what the stopped entry says:
// description, project, task, tags and billable flag. resume() starts a clone
// of it, as the web app's Continue does. The entries a pause and resume
// produce form a chain, and elapsed time is the chain total: the durations
// the server stored for its stopped entries plus the running clone's time,
// frozen while paused. A resume counts as a start: it is never replayed, and
// a refused one leaves the chain paused. While paused, the project and
// billable flag are the paused entry's and cannot be chosen. stop() ends the
// chain; while paused it only clears it. So does another client stopping the
// clone, a different running entry, and a new connection generation. The
// chain store keeps the chain for the account across restarts.
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
        Loading, // reading the secret, validating, or the first current-entry read
        Ready,
        Busy, // a start, stop or edit is in flight or its outcome is unknown
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
    Q_PROPERTY(Tokkl::Connection *connection READ connection WRITE setConnection NOTIFY connectionChanged)

    // The validated context.
    Q_PROPERTY(bool connected READ isConnected NOTIFY contextChanged)
    Q_PROPERTY(QVariantMap account READ account NOTIFY contextChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY contextChanged)
    Q_PROPERTY(Tokkl::Connection::State connectionState READ connectionState NOTIFY statusChanged)
    // Shown data is the last known: the latest request failed transiently, or
    // a current-entry read did and none has succeeded since.
    Q_PROPERTY(bool stale READ isStale NOTIFY statusChanged)
    // A workspace operation answered 403; writes stay blocked until a new
    // generation or reconnect().
    Q_PROPERTY(bool workspaceAccessLost READ workspaceAccessLost NOTIFY statusChanged)
    Q_PROPERTY(bool busy READ isBusy NOTIFY statusChanged)
    // start() or stop() would send a request now. False until a current-entry
    // read for the context has succeeded.
    Q_PROPERTY(bool canWrite READ canWrite NOTIFY statusChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY statusChanged)
    Q_PROPERTY(Status status READ status NOTIFY statusChanged)

    Q_PROPERTY(QVariant currentEntry READ currentEntryVariant NOTIFY currentEntryChanged)
    Q_PROPERTY(bool running READ isRunning NOTIFY currentEntryChanged)
    // The chain total while a chain runs or is paused.
    Q_PROPERTY(qint64 elapsedSeconds READ elapsedSeconds NOTIFY elapsedChanged)
    // H:MM:SS, as in the web app; 0:00:00 when nothing runs.
    Q_PROPERTY(QString elapsedText READ elapsedText NOTIFY elapsedChanged)

    // A chain is paused: nothing runs, and resume() would start its clone.
    Q_PROPERTY(bool paused READ isPaused NOTIFY chainChanged)
    // The seconds the server stored for the chain's stopped entries; 0
    // without a chain.
    Q_PROPERTY(qint64 chainSeconds READ chainSeconds NOTIFY chainChanged)

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
    static constexpr int pollIntervalMs = 30000;
    // A tick this late means the machine slept or the clock jumped.
    static constexpr int resumeGapMs = 10000;

    // Uses the system clock, and a SettingsChainStore on the application's
    // default QSettings.
    explicit TimerController(QObject *parent = nullptr);
    // Uses the given clock, which the controller does not own, and no chain
    // store until setChainStore().
    explicit TimerController(Clock *clock, QObject *parent = nullptr);
    ~TimerController() override;

    Connection *connection() const;
    void setConnection(Connection *connection);
    ChainStore *chainStore() const;
    // The controller does not own the store. Null keeps the chain in memory
    // only. Set it before the connection: the stored chain is read with the
    // first current entry of a connection.
    void setChainStore(ChainStore *store);

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
    std::optional<PauseChain> chain() const;

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

    // The actions return true when a request was sent, and stop() while
    // paused when it cleared the chain.
    //
    // Starts a new entry; refused while paused.
    Q_INVOKABLE bool start();
    // Stops the running entry and ends the chain. While paused it sends
    // nothing.
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
    // Reads the current entry and the projects again.
    void refresh();
    // The session woke from sleep; refresh at once. Not resume().
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
    void projectsChanged();
    void selectionChanged();
    void choiceChanged();
    void entryProjectChanged();
    void indicatorChanged();

private:
    void onTick();
    void onConnectionChanged();
    void onGenerationChanged();
    void reset();
    void beginMutation();
    void fetchEntry();
    void fetchProjects();
    void fetchLastEntry();
    // stoppedReply is the server's answer to a stop or edit that ended the
    // entry; its project wins over the one last read.
    void applyEntry(const std::optional<TimeEntry> &entry, const std::optional<TimeEntry> &stoppedReply = std::nullopt);
    // Reads the stored chain once per context, then ends or continues the
    // chain for the entry that runs now.
    void followChain(const std::optional<TimeEntry> &entry);
    void setChain(const std::optional<PauseChain> &chain);
    QString chainOwner() const;
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
    void finishMutation(const ApiError &error, bool succeeded);
    void loseWorkspace(const ApiError &error);
    void setError(const QString &error);
    void updateElapsed();
    bool readable() const;

    QPointer<Clock> m_clock;
    QPointer<Connection> m_connection;
    QPointer<ChainStore> m_chainStore;

    // Bumped by reset(); callbacks from an earlier epoch do nothing.
    quint64 m_epoch = 0;
    Connection::State m_lastState = Connection::Unconfigured;
    // The data of the current context was requested once.
    bool m_loaded = false;
    // A current-entry read for this context and workspace was applied, so
    // a start cannot split a timer already running on the server.
    bool m_entryKnown = false;
    // A current-entry read failed transiently and none has succeeded since.
    bool m_entryStale = false;

    std::optional<TimeEntry> m_entry;
    std::optional<PauseChain> m_chain;
    // The stored chain was read for this context, so the chain it holds is
    // the account's. A new generation then ends it.
    bool m_chainChecked = false;
    // The start time a resume sent, until a reply or the read after it shows
    // whether the server created the clone.
    QDateTime m_resumeStart;
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
    bool m_reconciling = false;
    bool m_workspaceLost = false;
    bool m_rediscoveryUsed = false;

    // Current-entry reads are numbered. A reply is applied only if no newer
    // read was applied and no mutation started after it was issued.
    quint64 m_readsIssued = 0;
    quint64 m_firstValidRead = 1;
    quint64 m_lastAppliedRead = 0;
    quint64 m_entryReadPending = 0; // number of the valid read in flight, or 0
    bool m_projectsPending = false;

    // The user picked the next-start choice since the last start or stop, so
    // no automatic default replaces it. Defaults themselves do not set it.
    bool m_nextStartPicked = false;
    // The project of an entry that stopped before the project list could
    // tell whether it is active; applied when the list arrives.
    std::optional<qint64> m_stopDefault;
    // Ask for the last entry's project after the next current-entry read.
    bool m_lastEntryWanted = false;
    quint64 m_lastEntryReads = 0;
    quint64 m_lastEntryRead = 0; // number of the last-entry read that may apply, or 0

    QDateTime m_lastTick;
    QDateTime m_nextPoll;
};

}
