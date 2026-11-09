#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "nextstartselection.h"
#include "projectcatalog.h"
#include "mutationgate.h"
#include "projectchoices.h"
#include "timeractions.h"
#include "timerstateclient.h"
#include "timerview.h"

#include <QObject>
#include <QVariant>

#include <optional>

namespace Tokkl
{

// What a panel shows of the timer, derived from the one state the client
// accepted; TimerController, its only subclass, acts and changes it.
class TimerModel : public TimerActions
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
    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)

    // The validated context.
    Q_PROPERTY(bool connected READ isConnected NOTIFY contextChanged)
    Q_PROPERTY(QVariantMap account READ account NOTIFY contextChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY contextChanged)
    Q_PROPERTY(Tokkl::Connection::State connectionState READ connectionState NOTIFY statusChanged)
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
    // The parts every panel words the label of chosenProjectId from
    // (ProjectLabelParts::toVariantMap()): the running or paused entry's
    // project while one is held, also when it is archived and so missing
    // from projects, otherwise the active project with that id. kind is
    // "none" for no project, "unknown" for one that is neither held nor
    // active or still unresolved, and "unavailable" for one the instance
    // no longer has.
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
    bool isBusy() const override;
    bool canWrite() const;
    // Something new could start now: canWrite(), and nothing runs, no
    // chain is paused and no session is active. A start and a Pomodoro
    // session's start both ask this, so the cooldown, a lost workspace and
    // a write in flight hold both.
    bool canStartNew() const override;
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
    PrimaryAction toggleAction() const override;
    bool holdsEntry() const override;
    Selection selection() const override;
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
    ProjectLabelParts chosenProjectLabel() const;
    QVariantMap chosenProjectLabelVariant() const;
    IndicatorState indicatorState() const;
    QString indicatorColor() const;

    static QString formatElapsed(qint64 seconds);

Q_SIGNALS:
    // A read of the workspace's projects answered 403.
    void workspaceRefused(const Tokkl::ApiError &error);

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
    // The held entry's project was resolved or changed.
    void entryProjectChanged();
    // chosenProjectLabel may have changed.
    void chosenProjectDetailsChanged();
    void indicatorChanged();

protected:
    // The client is not owned and must outlive the model.
    explicit TimerModel(TimerStateClient &client, QObject *parent = nullptr);

    const std::optional<TimerState> &heldState() const;
    void contextUpdated();
    // Shows the state held, applying the next-start defaults it asks for first.
    void showState();
    // A new context: the projects and the next start's choice are forgotten.
    void resetContext();
    // The workspace was lost: its projects and the next start's choice go.
    void forgetWorkspace();

    // Reads the projects when the workspace can be read and the list changed.
    void fetchProjects();
    // Reads the chosen project when the list lacks it, then shows it.
    void resolveChosenProject();
    // After a state: reads the last entry's project for the next start when asked.
    void readLastEntryIfWanted();
    bool readable() const;

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

    void showChosenProject();

    TimerStateClient &m_state;
    Connection &m_connection;

    // The client's state as shown for the workspace.
    TimerView m_shown;
    // The workspace's projects and the one read on its own.
    ProjectCatalog *m_catalog;
    // The running or paused entry's project, also when archived, and the
    // indicator of the chosen project, as the catalog last knew them.
    std::optional<Project> m_entryProject;
    ProjectCatalog::Indicator m_indicator;
    qint64 m_elapsed = 0;
    // What projectChoices last announced.
    QVariantList m_projectChoices;

protected:
    NextStartSelection *m_next;
    // The write that runs, the message of the last action and a lost workspace.
    MutationGate m_gate;
    QString m_error;
    bool m_workspaceLost = false;
};

}
