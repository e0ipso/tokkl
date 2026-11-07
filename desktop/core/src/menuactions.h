#pragma once

#include "pomodorosession.h"
#include "timermodel.h"

#include <QObject>
#include <QPointer>
#include <QString>
#include <QVariantMap>

namespace Tokkl
{

// One menu action as a panel shows it: whether it shows, whether it can be
// chosen, and the key of its text. A panel turns the key into its own words.
struct ActionState {
    bool visible = true;
    // False whenever visible is.
    bool enabled = false;
    QString label;

    bool operator==(const ActionState &other) const = default;
    // visible (bool), enabled (bool) and label (string).
    QVariantMap toVariantMap() const;
};

// Where the panels' menus differ. Each companion names its own policy, so a
// difference is written here rather than in one panel's copy of the rules.
struct MenuActionPolicy {
    // What Start, Stop, Project and Billable wait for.
    enum class WriteGate {
        // TimerModel::canWrite(): connected, the state read, nothing in
        // flight and no workspace lost.
        CanWrite,
        // Status Ready, which also holds them while the last action's
        // message shows and while the data shown is stale.
        Ready,
    };
    WriteGate writeGate = WriteGate::CanWrite;
    // A session disables Project and Billable, as neither reaches the open
    // pomodoro. Otherwise they stay as the timer allows; the timer then sets
    // the next start.
    bool sessionHoldsChoices = false;

    // The KDE panel: writes wait for canWrite, and a session holds the
    // project and billable choices.
    static MenuActionPolicy plasma();
    // The macOS menu bar app: writes wait for canWrite, and a session leaves
    // the choices to the timer.
    static MenuActionPolicy macos();
    // The GNOME menu, which has always read the published Status: writes wait
    // for Ready, and a session leaves the choices to the timer.
    static MenuActionPolicy gnome();
};

// Which timer and session actions a menu shows, which can be chosen, and the
// keys of their texts. Every panel builds its menu from this; the timer and
// the session still refuse what does not apply.
//
// Start or Stop (run) never pauses: Stop ends the chain, and discards it
// while paused. It shows without a session, in Timer mode, and in Pomodoro
// mode while a timer runs or is paused, so Pomodoro mode starts no timer.
// Start session shows in Pomodoro mode while no session is active and no
// timer runs or is paused, and can be chosen when the session says so. Next
// phase and End session show whenever a session is active, in either mode
// and whichever device started it. Project sets only the next start and is
// locked while an entry runs or a chain is paused. Billable is locked while
// paused; while an entry runs the timer edits that entry. Pomodoro mode is
// locked while a timer runs or is paused, or a session is active.
struct MenuActionStates {
    // label "start" or "stop".
    ActionState run;
    // label "startSession".
    ActionState startSession;
    // label: the phase Next phase starts, "work", "shortRest" or "longRest".
    ActionState nextPhase;
    // label "endSession".
    ActionState endSession;
    // label "project", or "projectRunning" or "projectPaused" while locked
    // by a held entry.
    ActionState project;
    // label "billable".
    ActionState billable;
    // label "pomodoroMode", or "pomodoroModeLocked" while locked.
    ActionState mode;

    bool operator==(const MenuActionStates &other) const = default;

    // A null session reads as Timer mode with no session.
    static MenuActionStates of(const TimerModel &timer, const PomodoroSession *session, const MenuActionPolicy &policy);
    // Each action's toVariantMap() under its name: run, startSession,
    // nextPhase, endSession, project, billable and mode.
    QVariantMap toVariantMap() const;
};

// MenuActionStates kept up to date for a timer and a session, for QML
// (TokklMenuActions) and for a panel that wants to hear of changes. It uses
// the KDE panel's policy unless given another.
class MenuActions : public QObject
{
    Q_OBJECT

    // Neither is owned.
    Q_PROPERTY(Tokkl::TimerModel *timer READ timer WRITE setTimer NOTIFY timerChanged)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session WRITE setSession NOTIFY sessionChanged)
    // MenuActionStates::toVariantMap() of the current states.
    Q_PROPERTY(QVariantMap states READ statesVariant NOTIFY changed)

public:
    explicit MenuActions(QObject *parent = nullptr);
    MenuActions(const MenuActionPolicy &policy, QObject *parent = nullptr);

    TimerModel *timer() const;
    void setTimer(TimerModel *timer);
    PomodoroSession *session() const;
    void setSession(PomodoroSession *session);

    const MenuActionStates &states() const;
    QVariantMap statesVariant() const;

Q_SIGNALS:
    void timerChanged();
    void sessionChanged();
    // The states changed.
    void changed();

private:
    void update();

    MenuActionPolicy m_policy;
    QPointer<TimerModel> m_timer;
    QPointer<PomodoroSession> m_session;
    MenuActionStates m_states;
};

}
