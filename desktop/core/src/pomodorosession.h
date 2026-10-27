#pragma once

#include "clock.h"
#include "pomodorocycle.h"
#include "pomodoropreferences.h"
#include "pomodoroqueue.h"
#include "pomodororecord.h"
#include "pomodorostore.h"
#include "timercontroller.h"

#include <QDateTime>
#include <QObject>
#include <QPointer>
#include <QString>

#include <optional>

namespace Tokkl
{

// The Pomodoro session for the panels: the mode, the phase that runs, the
// countdown, the alarm, and the actions Start session, Next phase and End
// session. It runs next to the timer controller and never starts or stops a
// timer itself. The cycle rules are the web app's (pomodorocycle.h); what
// follows are the desktop's.
//
// The mode is stored per device. It cannot change while a timer runs or is
// paused, or while a session is active.
//
// activate() is the panel's left-click. A timer running or paused gets
// TimerController::toggle(), whatever the mode. In Timer mode so does
// everything else. In Pomodoro mode a click starts a session when there is
// none, confirms Next phase while the alarm rings, and otherwise asks the
// platform to open the menu.
//
// Start session is possible in Pomodoro mode with no session, no timer
// running or paused, and an account bound, also while the instance is
// unreachable. It notes the click instant, reads the lengths once more, and
// starts at that instant with the lengths the read returns, or with the
// lengths last known when the read fails. A length changed on the web thus
// applies to the next session. A second click while the read runs does
// nothing. The session snapshots the timer's chosen project and billable
// flag and keeps its lengths until it ends.
//
// A phase ends only on Next phase. Once the planned end has passed the phase
// rings, and it keeps ringing until Next phase or End session, also when the
// app starts or wakes after the planned end. Work to rest saves nothing. Rest
// to work, End session and a handoff save the open pomodoro, from its work
// start to the confirm instant, snapped on the account's grid and time zone;
// the next pomodoro starts at the exact, unsnapped instant. The session
// change and the ended pomodoro go to the store in one write, through the
// queue, which then posts it as a stopped entry. A span too short to keep is
// dropped and message says so. When the account's time zone is unknown the
// span is snapped in UTC rather than dropped; the server snaps on write
// anyway.
//
// A running entry the timer sees, started after the open pomodoro began, is
// another client's timer: the session ends at that entry's start and the
// partial pomodoro is saved. The timer's 30 s poll drives this. The desktop
// starts no timer while Pomodoro mode is on, so every running entry seen
// during a session is foreign. While a session is active and nothing runs, a
// change to the timer's chosen project or billable flag goes into the
// session, so the open pomodoro and the ones after it use it.
//
// Before the connection's instance, sign-in method, email or secret changes,
// an active session ends at that instant and the queue is flushed, while the
// old account can still be written to.
//
// The session is written to the store on every change, under the connection's
// owner, so a restart finds it. A write the store refuses changes nothing and
// the action reports false. The record is read again whenever the owner
// changes.
class PomodoroSession : public QObject
{
    Q_OBJECT

    // Pomodoro mode is on. setPomodoroMode() is refused while modeLocked.
    Q_PROPERTY(bool pomodoroMode READ pomodoroMode NOTIFY modeChanged)
    // A timer runs or is paused, or a session is active.
    Q_PROPERTY(bool modeLocked READ modeLocked NOTIFY modeLockedChanged)

    Q_PROPERTY(bool active READ isActive NOTIFY sessionChanged)
    // "work", "shortRest" or "longRest"; empty without a session.
    Q_PROPERTY(QString phase READ phase NOTIFY sessionChanged)
    Q_PROPERTY(QDateTime phaseStart READ phaseStart NOTIFY sessionChanged)
    Q_PROPERTY(QDateTime plannedEnd READ plannedEnd NOTIFY sessionChanged)
    // Work phases of this round: the one that runs counts; a rest counts
    // the work phase before it. 0 without a session.
    Q_PROPERTY(int pomodoroNumber READ pomodoroNumber NOTIFY sessionChanged)
    // Work phases per round, from the lengths the session started with.
    Q_PROPERTY(int longRestEvery READ longRestEvery NOTIFY sessionChanged)
    // The kind of phase Next phase would start; empty without a session.
    Q_PROPERTY(QString nextPhase READ nextPhase NOTIFY sessionChanged)

    // Seconds to the planned end, rounded up, and past it, rounded down.
    Q_PROPERTY(qint64 remainingSeconds READ remainingSeconds NOTIFY countdownChanged)
    Q_PROPERTY(qint64 overtimeSeconds READ overtimeSeconds NOTIFY countdownChanged)
    // M:SS to the planned end, +M:SS past it; empty without a session.
    Q_PROPERTY(QString countdownText READ countdownText NOTIFY countdownChanged)

    // The planned end has passed and no action was taken yet.
    Q_PROPERTY(bool ringing READ isRinging NOTIFY ringingChanged)
    // The transition that rings, such as "workToShortRest"; empty otherwise.
    Q_PROPERTY(QString ringingTransition READ ringingTransition NOTIFY ringingChanged)

    Q_PROPERTY(bool canStartSession READ canStartSession NOTIFY canStartSessionChanged)
    // The last message for the user: the queue's, or that a pomodoro was
    // too short to save. It stays until clearMessage() or the next message.
    Q_PROPERTY(QString message READ message NOTIFY messageChanged)

public:
    // What a left-click did.
    enum class Activation {
        Handled,
        OpenMenu, // a session runs before its planned end; the platform opens the menu
        Ignored, // nothing applied: no account, or a Start already waits for its read
    };
    Q_ENUM(Activation)

    // Uses the clock, the timer, the preferences, the queue and the store,
    // none of which it owns.
    PomodoroSession(Clock *clock, TimerController *timer, PomodoroPreferences *preferences, PomodoroQueue *queue, PomodoroStore *store, QObject *parent = nullptr);

    bool pomodoroMode() const;
    // Returns false, and changes nothing, while modeLocked or when the
    // store refuses the choice.
    Q_INVOKABLE bool setPomodoroMode(bool pomodoro);
    bool modeLocked() const;

    bool isActive() const;
    QString phase() const;
    QDateTime phaseStart() const;
    QDateTime plannedEnd() const;
    int pomodoroNumber() const;
    int longRestEvery() const;
    QString nextPhase() const;
    qint64 remainingSeconds() const;
    qint64 overtimeSeconds() const;
    QString countdownText() const;
    bool isRinging() const;
    QString ringingTransition() const;
    bool canStartSession() const;
    QString message() const;

    // M:SS, with the minutes not wrapped at 60, and a leading + for
    // overtime. Negative seconds read as zero.
    static QString formatCountdown(qint64 seconds, bool overtime);

    // The panel's left-click.
    Q_INVOKABLE Activation activate();
    // The actions return true when they applied.
    Q_INVOKABLE bool startSession();
    Q_INVOKABLE bool confirmNextPhase();
    Q_INVOKABLE bool endSession();
    Q_INVOKABLE void clearMessage();

public Q_SLOTS:
    // The session woke from sleep: read the clock again at once.
    void resumed();

Q_SIGNALS:
    void modeChanged();
    void modeLockedChanged();
    void sessionChanged();
    void countdownChanged();
    void ringingChanged();
    void canStartSessionChanged();
    void messageChanged();

private:
    void onConnectionChanged();
    void onContextChanged();
    void onContextAboutToChange();
    void onEntryChanged();
    void onChoiceChanged();
    void onRefreshed(bool ok);
    void onTick();
    // Reads the owner's stored session when the owner changed.
    void followOwner();
    QString owner() const;
    bool accountBound() const;
    // Starts the session at the instant the click was recorded.
    void begin(const QDateTime &at);
    // Ends the session at at and queues the open pomodoro.
    bool end(const QDateTime &at);
    // The open pomodoro from its start to end, snapped; nullopt when it is
    // too short, with the message set.
    std::optional<UnsavedPomodoro> snapshot(const QDateTime &end);
    // Writes the session, which replaces the stored one, and an ended
    // pomodoro when there is one, in one write. Returns false when the
    // store refused.
    bool write(const std::optional<PomodoroSessionRecord> &session, const std::optional<UnsavedPomodoro> &item);
    std::optional<qint64> chosenProject() const;
    // Recomputes the derived values and emits what changed.
    void update();
    void updateClock();
    void setMessage(const QString &message);

    QPointer<Clock> m_clock;
    QPointer<TimerController> m_timer;
    QPointer<Connection> m_connection;
    QPointer<PomodoroPreferences> m_preferences;
    QPointer<PomodoroQueue> m_queue;
    QPointer<PomodoroStore> m_store;

    bool m_pomodoroMode = false;
    QString m_owner;
    std::optional<PomodoroSessionRecord> m_session;
    // A Start waits for its read of the lengths; m_startAt is its instant.
    bool m_startPending = false;
    QDateTime m_startAt;
    QString m_message;

    // Derived values, kept so a change can be told from a recomputation.
    // m_published is the session as last announced.
    std::optional<PomodoroSessionRecord> m_published;
    bool m_modeLocked = false;
    bool m_canStart = false;
    qint64 m_remaining = 0;
    qint64 m_overtime = 0;
    QString m_countdown;
    bool m_ringing = false;
    QString m_ringingTransition;
};

}
