#pragma once

#include "pomodorosession.h"
#include "timermodel.h"

#include <QObject>
#include <QPointer>
#include <QString>
#include <QVariantMap>

namespace Tokkl
{

// label is a key; each panel turns it into its own words.
struct ActionState {
    bool visible = true;
    // False whenever visible is.
    bool enabled = false;
    QString label;

    bool operator==(const ActionState &other) const = default;
    QVariantMap toVariantMap() const;
};

// The timer and session still refuse what does not apply. In Pomodoro mode
// Run shows only while a timer is held, so that mode starts no timer.
struct MenuActionStates {
    // "start" or "stop"
    ActionState run;
    ActionState startSession;
    // label: the phase Next phase starts.
    ActionState nextPhase;
    ActionState endSession;
    // "project", or "projectRunning"/"projectPaused" while a held entry locks it.
    ActionState project;
    ActionState billable;
    // "pomodoroMode", or "pomodoroModeLocked".
    ActionState mode;

    bool operator==(const MenuActionStates &other) const = default;

    // A null session reads as Timer mode with no session. waitForReady (GNOME)
    // also greys out the write items until status Ready.
    static MenuActionStates of(const TimerModel &timer, const PomodoroSession *session, bool waitForReady = false);
    QVariantMap toVariantMap() const;
};

class MenuActions : public QObject
{
    Q_OBJECT

    // Neither is owned.
    Q_PROPERTY(Tokkl::TimerModel *timer READ timer WRITE setTimer NOTIFY timerChanged)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session WRITE setSession NOTIFY sessionChanged)
    Q_PROPERTY(QVariantMap states READ statesVariant NOTIFY changed)

public:
    explicit MenuActions(QObject *parent = nullptr);

    TimerModel *timer() const;
    void setTimer(TimerModel *timer);
    PomodoroSession *session() const;
    void setSession(PomodoroSession *session);

    const MenuActionStates &states() const;
    QVariantMap statesVariant() const;

Q_SIGNALS:
    void timerChanged();
    void sessionChanged();
    void changed();

private:
    void update();

    QPointer<TimerModel> m_timer;
    QPointer<PomodoroSession> m_session;
    MenuActionStates m_states;
};

}
