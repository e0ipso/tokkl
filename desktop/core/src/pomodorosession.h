#pragma once

#include "apitypes.h"
#include "clock.h"
#include "epoch.h"
#include "pomodorostore.h"
#include "sessionstate.h"
#include "timeractions.h"

#include <QDateTime>
#include <QObject>
#include <QString>

namespace Tokkl
{

// The Pomodoro session for the panels: the mode, the phase that runs, the
// countdown, the alarm, and the actions Start session, Next phase and End
// session. The session is the server's, so a session started, advanced or
// ended on any device shows here, in either mode. Everything shown comes
// from the pomodoro of the timer state the SessionState holds; the
// device adds only the mode and the alarm.
//
// The mode is stored per device. It decides what a click starts when nothing
// runs, and the user cannot change it while a timer runs or is paused, or
// while a session is active. When the store reads another place
// (PomodoroStore::sourceChanged()), the session takes the mode stored there.
//
// activate() is the panel's left-click. With a session active, a click
// confirms Next phase while the alarm rings and otherwise asks the platform to
// open the menu. Without one, a timer running or paused gets the timer's
// toggle(), and so does everything in Timer mode. In Pomodoro mode the click
// starts a session.
//
// The session knows the timer only through TimerActions, and the server's
// state only through a SessionState: the timer's own state client, so the
// two always share one state. It hears of a new account only from
// SessionState::accountReset().
//
// Start session sends the timer's chosen project and billable flag; the
// server takes the account's lengths and starts the open pomodoro on its own
// clock. Next phase and End session send the revision of the state shown, so
// a confirm made after another device already moved the session is refused
// with a 409, and the state that refused it shows. An answer that leaves the
// outcome unknown is never sent again: the state client settles it with a
// later read, and until then no session action is possible. A failed action
// leaves the connection's message in message; a pomodoro the server dropped
// as too short leaves a message of its own.
//
// The time is the server's, as SessionState::serverNow() estimates it.
// phaseStart and plannedEnd are shown on this device's clock, so a panel
// that counts down by itself agrees with the countdown here. The phase rings
// from its planned end until a state shows another phase start or no
// session, also when the app starts or wakes after the planned end, and also
// while the instance is unreachable, from the last state held. The check
// runs on every tick, on resumed() and on each new state.
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
    // On this device's clock; invalid without a session.
    Q_PROPERTY(QDateTime phaseStart READ phaseStart NOTIFY sessionChanged)
    Q_PROPERTY(QDateTime plannedEnd READ plannedEnd NOTIFY sessionChanged)
    // The pomodoro's place in the round, from 1: a rest counts the work
    // phase before it. 0 without a session.
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

    // The planned end has passed and the phase has not changed since.
    Q_PROPERTY(bool ringing READ isRinging NOTIFY ringingChanged)
    // The transition that rings, such as "workToShortRest"; empty otherwise.
    Q_PROPERTY(QString ringingTransition READ ringingTransition NOTIFY ringingChanged)

    // Pomodoro mode is on, no session action waits, and the timer could
    // start something new (TimerActions::canStartNew()).
    Q_PROPERTY(bool canStartSession READ canStartSession NOTIFY canStartSessionChanged)
    // The last message for the user: why an action failed, or that a
    // pomodoro was too short to save. It stays until clearMessage(), the
    // next action or the next message.
    Q_PROPERTY(QString message READ message NOTIFY messageChanged)

public:
    // What a left-click did.
    enum class Activation {
        Handled, // a request was sent
        OpenMenu, // a session runs before its planned end; the platform opens the menu
        Ignored, // nothing sent: no account, no state read yet, or an action waits for its answer or its outcome
    };
    Q_ENUM(Activation)

    // Uses the clock, the timer, the state and the store, none of which it
    // owns; all of them must outlive the session. state must be the one the
    // timer reads.
    PomodoroSession(Clock &clock, TimerActions &timer, SessionState &state, PomodoroStore &store, QObject *parent = nullptr);

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

    // What activate() does now: Session while a session is active, the
    // timer's toggle while it holds an entry or in Timer mode, and
    // StartSession otherwise.
    PrimaryAction primaryAction() const;
    // The panel's left-click.
    Q_INVOKABLE Activation activate();
    // The actions return true when they sent a request.
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
    // The session values the panels see, kept so a change can be told from
    // a recomputation.
    struct View {
        bool active = false;
        QString phase;
        QDateTime phaseStart;
        QDateTime plannedEnd;
        int pomodoroNumber = 0;
        int longRestEvery = 0;
        QString nextPhase;

        bool operator==(const View &other) const = default;
    };

    const TimerPomodoro *pomodoro() const;
    bool timerHeld() const;
    // An action is on its way, or the outcome of one is not known yet.
    bool busy() const;
    // Sends a session action with the revision shown.
    bool sendWithRevision(void (SessionState::*action)(SessionState::ActionCallback));
    SessionState::ActionCallback finishing();
    void onStateChanged();
    void onAccountReset();
    // The store reads another place: takes the mode stored there, also
    // while the mode is locked.
    void reloadMode();
    // Recomputes the derived values and emits what changed.
    void update();
    void updateClock();
    void setMessage(const QString &message);

    TimerActions &m_timer;
    SessionState &m_client;
    PomodoroStore &m_store;

    bool m_pomodoroMode;
    bool m_pending = false; // an action waits for its answer
    // Advanced on accountReset(): the answer to an action sent before never
    // comes, and one that does is ignored.
    Epoch m_epoch;
    QString m_message;
    // The last discarded pomodoro told about, so a state seen twice tells it
    // once.
    qint64 m_discardedEntry = 0;
    // The server start of the phase that rang. It rings until a state shows
    // another phase, also if the clock is set back.
    QDateTime m_rangPhase;

    View m_view;
    bool m_modeLocked = false;
    bool m_canStart = false;
    qint64 m_remaining = 0;
    qint64 m_overtime = 0;
    QString m_countdown;
    bool m_ringing = false;
    QString m_ringingTransition;
};

}
