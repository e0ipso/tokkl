#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "nextstartselection.h"
#include "projectcatalog.h"
#include "projectchoices.h"
#include "timeractions.h"
#include "timerstateclient.h"
#include "timerview.h"

#include <QObject>
#include <QPointer>
#include <QVariant>

#include <functional>
#include <optional>

namespace Tokkl
{

class ChosenProject;

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

// How TimerCoordinator changes what a TimerModel shows, apart from what the
// panels read, in three roles. Each change is one operation that sends
// every notification it causes; the coordinator emits none of the model's
// signals. The model implements all three for its subclass,
// TimerController, which hands them to the coordinator, so a panel holding
// a TimerModel can only read. Each consumer takes only the roles it uses:
// ProjectLoader takes the catalog alone.

// The state shown: the client and clock it is read from, and the changes of
// connection, context, activity and state.
class TimerStateUpdates
{
public:
    virtual ~TimerStateUpdates() = default;

    // Reads the state, the connection and the clock (for elapsed time and
    // ticks) from now on. Not owned. Announces nothing: connectionReplaced()
    // does once the coordinator follows the new client.
    virtual void bind(TimerStateClient *client, Clock *clock) = 0;
    virtual Clock *clock() const = 0;
    // The state the client accepted; none without a client.
    virtual const std::optional<TimerState> &heldState() const = 0;

    // Another state client, or none: announces the connection and the next
    // start's choice.
    virtual void connectionReplaced() = 0;
    // The connection's account, workspace or state changed: announces the
    // context and the status.
    virtual void contextUpdated() = 0;
    // What the actions do (TimerActivity) changed: announces the status.
    virtual void activityChanged() = 0;

    // Shows the state held. The next-start defaults the change asks for
    // apply before the panels hear of it; then the change, the elapsed time
    // and the status are announced.
    virtual void showState() = 0;
    // A new context: the projects and the next start's choice are forgotten and every answer on its way is dropped. Then shows the
    // state held and announces the context and the status.
    virtual void resetContext() = 0;
    // The workspace was lost: its projects and the next start's choice are
    // forgotten, the state shows without the workspace's data, and the
    // status is announced.
    virtual void forgetWorkspace() = 0;
};

// The project and billable flag of the next start, as the user picks them
// and a start uses them.
class TimerSelectionUpdates
{
public:
    virtual ~TimerSelectionUpdates() = default;

    // The project and billable flag of the next start.
    virtual NextStartSelection::Choice nextStart() const = 0;
    // A start or resume is on its way: a default that answers later no
    // longer replaces the next start's choice, and a pick lasts only until
    // it.
    virtual void startSent() = 0;
    // The choice for a project the menu offers, or none for anything else;
    // see NextStartSelection::forProject().
    virtual std::optional<NextStartSelection::Choice> choiceFor(const QVariant &projectId) const = 0;
    // A pick by the user, which no default replaces until the next start or
    // stop.
    virtual void pick(const NextStartSelection::Choice &choice) = 0;
    virtual void pickBillable(bool billable) = 0;
    // Asks for the last entry's project after the next state.
    virtual void wantLastEntry() = 0;
};

// The reads ProjectLoader may start, each landing in the model, which
// tells the panels of what changed: the workspace's projects, a project
// read on its own, and the last entry's project for the next start. The
// loader decides when; it never holds the catalog or the selection.
class TimerCatalogUpdates
{
public:
    virtual ~TimerCatalogUpdates() = default;

    // The connection may read the workspace now.
    virtual bool readable() const = 0;
    // Reads the workspace's projects through the connection, unless a read
    // is on its way; see ProjectCatalog::fetch().
    virtual void readProjects(ProjectCatalog::ListRead read) = 0;
    // Reads project id of the workspace on its own when the list, once
    // known, lacks it and its own read is missing, out of date and not on
    // its way. The answer counts while stillWanted(id) is true.
    virtual void lookUpProject(qint64 id, std::function<bool(qint64)> stillWanted) = 0;
    // True once after the last entry's project was asked for.
    virtual bool takeLastEntryWanted() = 0;
    // Reads the account's recent entries for the next start's default, by
    // the server's clock; see NextStartSelection::readLastEntry().
    virtual void readLastEntry(std::function<bool()> stillWanted) = 0;
    // Calls answered, with context, after each project list and each
    // single-project answer the model has taken in.
    virtual void onProjectsAnswered(QObject *context, std::function<void()> answered) = 0;
    // Shows the chosen project and the indicator as the catalog knows them.
    virtual void showChosenProject() = 0;
};

// The three roles of one model, as TimerController hands them over.
struct TimerModelRoles {
    TimerStateUpdates *state = nullptr;
    TimerSelectionUpdates *selection = nullptr;
    TimerCatalogUpdates *catalog = nullptr;
};

// What a panel shows of the timer: the running entry of the connection's
// validated account and workspace, its elapsed time, the pause chain, the
// projects, the project and billable flag chosen for the next start, and a
// status. Its public interface only reads. TimerCoordinator binds it to a
// TimerStateClient and changes it through its roles (TimerStateUpdates,
// TimerSelectionUpdates, TimerCatalogUpdates); the panels act through the
// coordinator.
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
// The model shows the projects it names and starts no read: ProjectCatalog
// keeps what is known of the workspace's projects, ChosenProject shows the
// chosen one from it, and ProjectLoader, the coordinator's, reads the list,
// a chosen project the list lacks and the last entry into them.
// NextStartSelection holds the next start's choice, and the model applies
// its defaults as the states it shows ask for them.
class TimerModel : public QObject, protected TimerStateUpdates, protected TimerSelectionUpdates, protected TimerCatalogUpdates
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
    // chosenProjectDetails as the parts every panel words its label from
    // (ProjectLabelParts::toVariantMap()): empty parts for no project and
    // for one that is neither held nor active.
    Q_PROPERTY(QVariantMap chosenProjectLabel READ chosenProjectLabelVariant NOTIFY chosenProjectDetailsChanged)
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
    // The project of the next start can be chosen now: canWrite(), and no
    // entry runs, no chain is paused and no session is active. A held
    // entry's project is fixed, and a session's open pomodoro is a running
    // entry whose project is the session's.
    bool canChooseProject() const;
    // Billable can be chosen now: canWrite(), no chain is paused (a resume
    // copies the chain's flag) and no session is active (the open pomodoro
    // is the session's). While an entry runs the choice edits that entry.
    bool canChooseBillable() const;
    // What the timer's toggle does: Pause while an entry runs, Resume while
    // a chain is paused, otherwise Start.
    PrimaryAction toggleAction() const;
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
    QVariant chosenProjectId() const;
    // chosenProjectId as the id it holds; none for no project.
    std::optional<qint64> chosenProject() const;
    bool chosenBillable() const;
    std::optional<Project> entryProject() const;
    QVariant entryProjectVariant() const;
    QVariant chosenProjectDetails() const;
    ProjectLabelParts chosenProjectLabel() const;
    QVariantMap chosenProjectLabelVariant() const;
    IndicatorState indicatorState() const;
    QString indicatorColor() const;

    static QString formatElapsed(qint64 seconds);

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

    // The roles, for the subclass to hand to the coordinator.
    TimerModelRoles roles();

    // TimerStateUpdates.
    void bind(TimerStateClient *client, Clock *clock) override;
    Clock *clock() const override;
    const std::optional<TimerState> &heldState() const override;
    void connectionReplaced() override;
    void contextUpdated() override;
    void activityChanged() override;
    void showState() override;
    void resetContext() override;
    void forgetWorkspace() override;

    // TimerSelectionUpdates.
    NextStartSelection::Choice nextStart() const override;
    void startSent() override;
    std::optional<NextStartSelection::Choice> choiceFor(const QVariant &projectId) const override;
    void pick(const NextStartSelection::Choice &choice) override;
    void pickBillable(bool billable) override;
    void wantLastEntry() override;

    // TimerCatalogUpdates.
    bool readable() const override;
    void readProjects(ProjectCatalog::ListRead read) override;
    void lookUpProject(qint64 id, std::function<bool(qint64)> stillWanted) override;
    bool takeLastEntryWanted() override;
    void readLastEntry(std::function<bool()> stillWanted) override;
    void onProjectsAnswered(QObject *context, std::function<void()> answered) override;
    void showChosenProject() override;

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
    // Announces what stage() changed, and updates elapsed time.
    void publish(const Change &change);
    void onProjectReadFailed(const ApiError &error);
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
    qint64 m_elapsed = 0;
    // What projectChoices last announced.
    QVariantList m_projectChoices;
};

}
