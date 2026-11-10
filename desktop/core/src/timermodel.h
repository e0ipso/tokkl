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

class TimerModel : public TimerActions
{
    Q_OBJECT

public:
    // Ready is a validated account whose current entry is known and nothing
    // waits or failed.
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

    enum class IndicatorState {
        None, // no project, or the instance no longer has it (404)
        Pending, // the project's details are still being read
        Project, // the project is known, archived or not
    };
    Q_ENUM(IndicatorState)

    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)

    Q_PROPERTY(bool connected READ isConnected NOTIFY contextChanged)
    Q_PROPERTY(QVariantMap account READ account NOTIFY contextChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY contextChanged)
    Q_PROPERTY(Tokkl::Connection::State connectionState READ connectionState NOTIFY statusChanged)
    Q_PROPERTY(bool stale READ isStale NOTIFY statusChanged)
    // Writes stay blocked until a new generation or a reconnect.
    Q_PROPERTY(bool workspaceAccessLost READ workspaceAccessLost NOTIFY statusChanged)
    Q_PROPERTY(bool busy READ isBusy NOTIFY statusChanged)
    // False until the context's state has been read.
    Q_PROPERTY(bool canWrite READ canWrite NOTIFY statusChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY statusChanged)
    Q_PROPERTY(Status status READ status NOTIFY statusChanged)

    Q_PROPERTY(QVariant currentEntry READ currentEntryVariant NOTIFY currentEntryChanged)
    Q_PROPERTY(bool running READ isRunning NOTIFY currentEntryChanged)
    Q_PROPERTY(qint64 elapsedSeconds READ elapsedSeconds NOTIFY elapsedChanged)
    // H:MM in whole minutes.
    Q_PROPERTY(QString elapsedText READ elapsedText NOTIFY elapsedChanged)

    Q_PROPERTY(bool paused READ isPaused NOTIFY chainChanged)
    Q_PROPERTY(qint64 chainSeconds READ chainSeconds NOTIFY chainChanged)
    // Its open pomodoro is the running entry, which running and currentEntry
    // leave out.
    Q_PROPERTY(bool sessionActive READ isSessionActive NOTIFY sessionActiveChanged)

    Q_PROPERTY(QVariantList projects READ projects NOTIFY projectsChanged)
    Q_PROPERTY(bool projectsIncomplete READ projectsIncomplete NOTIFY projectsChanged)
    // Leaves out checked and enabled, so the list changes only with the projects
    // and the held entry's project.
    Q_PROPERTY(QVariantList projectChoices READ projectChoicesVariant NOTIFY projectChoicesChanged)

    // The held entry's project and billable flag, else the next start's choice.
    Q_PROPERTY(QVariant chosenProjectId READ chosenProjectId NOTIFY choiceChanged)
    Q_PROPERTY(bool chosenBillable READ chosenBillable NOTIFY choiceChanged)
    // The held entry's project even when archived, else the active project with
    // that id.
    Q_PROPERTY(QVariantMap chosenProjectLabel READ chosenProjectLabelVariant NOTIFY chosenProjectDetailsChanged)
    // The colour is empty outside the Project state. A string keeps the core
    // free of Qt Gui.
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
    // A start and a session start both ask this, so the cooldown, a lost
    // workspace and a write in flight hold both.
    bool canStartNew() const override;
    // A held entry's project is fixed, and a session's open pomodoro has the
    // session's project.
    bool canChooseProject() const;
    // A resume copies the chain's flag. While an entry runs, the choice edits it.
    bool canChooseBillable() const;
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
    ProjectChoices projectChoices() const;
    QVariantList projectChoicesVariant() const;
    QVariant chosenProjectId() const;
    std::optional<qint64> chosenProject() const;
    bool chosenBillable() const;
    ProjectLabelParts chosenProjectLabel() const;
    QVariantMap chosenProjectLabelVariant() const;
    IndicatorState indicatorState() const;
    QString indicatorColor() const;

    static QString formatElapsed(qint64 seconds);

Q_SIGNALS:
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
    void entryProjectChanged();
    void chosenProjectDetailsChanged();
    void indicatorChanged();

protected:
    // The client must outlive the model.
    explicit TimerModel(TimerStateClient &client, QObject *parent = nullptr);

    const std::optional<TimerState> &heldState() const;
    void contextUpdated();
    void showState();
    void resetContext();
    void forgetWorkspace();

    void fetchProjects();
    void resolveChosenProject();
    void readLastEntryIfWanted();
    bool readable() const;

private:
    struct Change {
        std::optional<TimeEntry> was;
        bool entryChanged = false;
        bool chainChanged = false;
        bool sessionChanged = false;
        // The state shows the entry stopped, rather than a context that went away.
        bool stopped = false;
    };

    // Announces nothing yet, so the next-start defaults apply before the panels
    // see the change.
    Change stage();
    void applyDefaults(const Change &change);
    void publish(const Change &change);
    void onProjectReadFailed(const ApiError &error);
    void updateElapsed();
    void updateProjectChoices();

    void showChosenProject();

    TimerStateClient &m_state;
    Connection &m_connection;

    TimerView m_shown;
    ProjectCatalog *m_catalog;
    std::optional<Project> m_entryProject;
    ProjectCatalog::Indicator m_indicator;
    qint64 m_elapsed = 0;
    QVariantList m_projectChoices;

protected:
    NextStartSelection *m_next;
    MutationGate m_gate;
    QString m_error;
    bool m_workspaceLost = false;
};

}
