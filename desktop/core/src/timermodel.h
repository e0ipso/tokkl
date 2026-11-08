#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "nextstartselection.h"
#include "projectchoices.h"
#include "timerstateclient.h"
#include "timerview.h"

#include <QObject>
#include <QPointer>
#include <QVariant>

#include <optional>

namespace Tokkl
{

class ChosenProject;
class ProjectCatalog;

// What the timer's actions are doing, as the model shows it. TimerCoordinator
// is the one source; the model only reads it.
class TimerActivity
{
public:
    virtual ~TimerActivity() = default;

    // A write runs: its answer has not come yet.
    virtual bool writing() const = 0;
    // The message of the last action, or of a lost workspace; empty for
    // none.
    virtual QString message() const = 0;
    // A workspace operation answered 403. The model hides the workspace's
    // data and reads nothing of it until a new generation or a reconnect.
    virtual bool workspaceLost() const = 0;
};

// What a panel shows of the timer: the running entry of the connection's
// validated account and workspace, its elapsed time, the pause chain, the
// projects, the project and billable flag chosen for the next start, and a
// status. Panels only read it. TimerCoordinator binds it to a
// TimerStateClient and drives it through the section below marked as its;
// the panels act through the coordinator.
//
// What it shows is derived from one timer state, the one the client
// accepted, and from nothing else. Elapsed time is recomputed on every clock
// tick from the entry's server start and the client's server time, so a
// sleep, a late tick or a skewed clock loses nothing. While the state holds
// a Pomodoro session, its open pomodoro is the running entry and belongs to
// the session: running and paused are false and sessionActive is true. A
// chain or entry in another workspace is not shown, and neither is anything
// of a workspace the coordinator lost access to.
//
// The model resolves the projects it names: ProjectCatalog keeps what is
// known of the workspace's projects, and ChosenProject reads the chosen one
// on its own when the list lacks it, so the menu and the indicator can name
// it. NextStartSelection holds the next start's choice, and the model
// applies its defaults as the states it shows ask for them.
class TimerModel : public QObject
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

    // Not owned. The connection is the state client's.
    Q_PROPERTY(Tokkl::Connection *connection READ connection NOTIFY connectionChanged)

    // The validated context.
    Q_PROPERTY(bool connected READ isConnected NOTIFY contextChanged)
    Q_PROPERTY(QVariantMap account READ account NOTIFY contextChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY contextChanged)
    Q_PROPERTY(Tokkl::AuthSession::State connectionState READ connectionState NOTIFY statusChanged)
    // Shown data is the last known: the latest request failed transiently.
    Q_PROPERTY(bool stale READ isStale NOTIFY statusChanged)
    // A workspace operation answered 403; writes stay blocked until a new
    // generation or a reconnect.
    Q_PROPERTY(bool workspaceAccessLost READ workspaceAccessLost NOTIFY statusChanged)
    Q_PROPERTY(bool busy READ isBusy NOTIFY statusChanged)
    // A start or stop would send a request now. False until the state of the
    // context has been read.
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

    // A chain is paused: nothing runs, and a resume would start its clone.
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
    // The rows of the project submenu after No project, as
    // ProjectChoices::toVariantList() gives them: the held entry's archived
    // project, the note for a cut-short list, then the active projects.
    // Whether a row is checked or can be chosen is left out, so the list
    // changes only with the projects and the held entry's project; a
    // project row is checked when it is chosenProjectId, and offered while
    // canWrite allows a choice.
    Q_PROPERTY(QVariantList projectChoices READ projectChoicesVariant NOTIFY projectChoicesChanged)

    // What the menu shows: the running or paused entry's project and
    // billable flag, or the choices for the next start when nothing runs.
    Q_PROPERTY(QVariant chosenProjectId READ chosenProjectId NOTIFY choiceChanged)
    Q_PROPERTY(bool chosenBillable READ chosenBillable NOTIFY choiceChanged)
    // The running or paused entry's project as a project map, also when it is
    // archived and so missing from projects; null without one or while
    // unresolved. A project the instance no longer has is a map with an
    // empty name.
    Q_PROPERTY(QVariant entryProject READ entryProjectVariant NOTIFY entryProjectChanged)
    // The project map the menu names for chosenProjectId: entryProject while
    // an entry runs or a chain is paused and it is that project, otherwise
    // the active project with that id; null for no project or one that is
    // neither.
    Q_PROPERTY(QVariant chosenProjectDetails READ chosenProjectDetails NOTIFY chosenProjectDetailsChanged)
    // The project behind chosenProjectId for the panel indicator, and its
    // colour as lowercase #rrggbb. The colour is empty outside the Project
    // state and for any other value. A string keeps the core free of Qt Gui.
    Q_PROPERTY(IndicatorState indicatorState READ indicatorState NOTIFY indicatorChanged)
    Q_PROPERTY(QString indicatorColor READ indicatorColor NOTIFY indicatorChanged)

public:
    ~TimerModel() override;

    TimerStateClient *stateClient() const;
    Connection *connection() const;

    bool isConnected() const;
    QVariantMap account() const;
    qint64 workspaceId() const;
    Connection::State connectionState() const;
    bool isStale() const;
    bool workspaceAccessLost() const;
    bool isBusy() const;
    bool canWrite() const;
    // Something new could start now: canWrite(), and nothing runs, no
    // chain is paused and no session is active. A start and a Pomodoro
    // session's start both ask this, so the cooldown, a lost workspace and
    // a write in flight hold both.
    bool canStartNew() const;
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
    // The project submenu every panel shows; see ProjectChoices.
    ProjectChoices projectChoices() const;
    QVariantList projectChoicesVariant() const;
    // The choices for the next start, for the connection's account: null or
    // a project id, and the billable flag.
    QVariant selectedProjectId() const;
    bool billable() const;
    QVariant chosenProjectId() const;
    // chosenProjectId as the id it holds; none for no project.
    std::optional<qint64> chosenProject() const;
    bool chosenBillable() const;
    std::optional<Project> entryProject() const;
    QVariant entryProjectVariant() const;
    QVariant chosenProjectDetails() const;
    IndicatorState indicatorState() const;
    QString indicatorColor() const;

    static QString formatElapsed(qint64 seconds);

    // ----- driven by TimerCoordinator ---------------------------------------
    //
    // The coordinator binds the model to a state client and tells it when
    // the context or the workspace changes, what its writes did and what
    // the user picked. The model owns the project catalog and the next
    // start's selection, and keeps both in step with the state it shows.
    // Panels only read the model.

    // Reads the state, the connection and the clock (for elapsed time and
    // ticks) from now on. Not owned.
    void bind(TimerStateClient *client, Clock *clock);
    Clock *clock() const;
    // The state the client accepted; none without a client.
    const std::optional<TimerState> &heldState() const;
    // The connection may read the workspace now.
    bool readable() const;

    // Shows the state held. The next-start defaults the change asks for
    // apply before the panels hear of it; then the change is announced and
    // elapsed time and the chosen project follow.
    void showState();
    // The server's reply to a stop or edit from here that ended the entry
    // shown. It names the project the server stopped, which another device
    // may have changed since the last state; the state that shows the stop
    // takes it for the next-start default. It counts only for the stop of
    // the entry it names.
    void entryEnded(const TimeEntry &reply);
    // A new context: the projects, the next start's choice and a stop reply
    // are forgotten and every answer on its way is dropped. Then shows the
    // state held.
    void resetContext();
    // The workspace was lost: its projects and the next start's choice are
    // forgotten, and the state shows without the workspace's data.
    void forgetWorkspace();
    // Reads the workspace's projects, when readable().
    void fetchProjects();

    // The project and billable flag of the next start.
    NextStartSelection::Choice nextStart() const;
    // A start or resume is on its way: a default that answers later no
    // longer replaces the next start's choice, and a pick lasts only until
    // it.
    void startSent();
    // The choice for a project the menu offers, or none for anything else;
    // see NextStartSelection::forProject().
    std::optional<NextStartSelection::Choice> choiceFor(const QVariant &projectId) const;
    // A pick by the user, which no default replaces until the next start or
    // stop.
    void pick(const NextStartSelection::Choice &choice);
    void pickProjectId(const QVariant &projectId);
    void pickBillable(bool billable);
    // Asks for the last entry's project after the next state.
    void wantLastEntry();
    // After a state: when the last entry was asked for, reads its project
    // for the next start, unless a session is active, an entry runs or the
    // workspace cannot be read. The answer applies only while the
    // workspace is kept and nothing runs.
    void readLastEntryIfWanted();

Q_SIGNALS:
    // A read of the workspace's projects answered 403: the account may have
    // lost the workspace. The coordinator decides.
    void workspaceRefused(const Tokkl::ApiError &error);

    void connectionChanged();
    void contextChanged();
    void statusChanged();
    void currentEntryChanged();
    void elapsedChanged();
    void chainChanged();
    void sessionActiveChanged();
    void projectsChanged();
    void projectChoicesChanged();
    void selectionChanged();
    void choiceChanged();
    void entryProjectChanged();
    void chosenProjectDetailsChanged();
    void indicatorChanged();

protected:
    // The model reads what the actions do from activity, which must outlive
    // it. A subclass that owns the activity passes it once built.
    explicit TimerModel(QObject *parent = nullptr);
    void setActivity(const TimerActivity *activity);

private:
    // What a new state changed in the view, between stage() and publish().
    struct Change {
        // The entry shown before.
        std::optional<TimeEntry> was;
        bool entryChanged = false;
        bool chainChanged = false;
        bool sessionChanged = false;
        // The state shows the entry stopped, rather than a context that went
        // away.
        bool stopped = false;
    };

    // Takes the view of the state held, announcing nothing yet, so the
    // next-start defaults the change asks for apply before the panels see
    // it.
    Change stage();
    // The next-start defaults a change asks for.
    void applyDefaults(const Change &change);
    // Announces what stage() changed, and updates elapsed time and the
    // chosen project.
    void publish(const Change &change);
    void onProjectReadFailed(const ApiError &error);
    // Reads the chosen project when projects lacks it, then updates
    // entryProject and the indicator.
    void resolveProject();
    void updateElapsed();
    void updateProjectChoices();

    const TimerActivity *m_activity = nullptr;
    QPointer<Clock> m_clock;
    QPointer<TimerStateClient> m_state;
    QPointer<Connection> m_connection;

    // The client's state as shown for the workspace.
    TimerView m_shown;
    // The workspace's projects and the one read on its own.
    ProjectCatalog *m_catalog;
    ChosenProject *m_chosen;
    NextStartSelection *m_next;
    // See entryEnded().
    std::optional<TimeEntry> m_stopReply;
    qint64 m_elapsed = 0;
    // What projectChoices last announced.
    QVariantList m_projectChoices;
};

}
