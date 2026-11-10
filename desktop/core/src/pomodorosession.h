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

// Session actions send the revision shown, so a confirm after another device
// moved the session gets a 409. Rings past the planned end, also offline.
class PomodoroSession : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool pomodoroMode READ pomodoroMode NOTIFY modeChanged)
    Q_PROPERTY(bool modeLocked READ modeLocked NOTIFY modeLockedChanged)

    Q_PROPERTY(bool active READ isActive NOTIFY sessionChanged)
    // "work", "shortRest" or "longRest"; empty without a session.
    Q_PROPERTY(QString phase READ phase NOTIFY sessionChanged)
    // On this device's clock.
    Q_PROPERTY(QDateTime phaseStart READ phaseStart NOTIFY sessionChanged)
    Q_PROPERTY(QDateTime plannedEnd READ plannedEnd NOTIFY sessionChanged)
    // From 1; a rest counts the work phase before it. 0 without a session.
    Q_PROPERTY(int pomodoroNumber READ pomodoroNumber NOTIFY sessionChanged)
    Q_PROPERTY(int longRestEvery READ longRestEvery NOTIFY sessionChanged)
    Q_PROPERTY(QString nextPhase READ nextPhase NOTIFY sessionChanged)

    // Remaining rounds up, overtime rounds down.
    Q_PROPERTY(qint64 remainingSeconds READ remainingSeconds NOTIFY countdownChanged)
    Q_PROPERTY(qint64 overtimeSeconds READ overtimeSeconds NOTIFY countdownChanged)
    // M:SS to the planned end, +M:SS past it.
    Q_PROPERTY(QString countdownText READ countdownText NOTIFY countdownChanged)

    Q_PROPERTY(bool ringing READ isRinging NOTIFY ringingChanged)
    Q_PROPERTY(QString ringingTransition READ ringingTransition NOTIFY ringingChanged)

    Q_PROPERTY(bool canStartSession READ canStartSession NOTIFY canStartSessionChanged)
    // Stays until clearMessage(), the next action or the next message.
    Q_PROPERTY(QString message READ message NOTIFY messageChanged)

public:
    enum class Activation {
        Handled, // a request was sent
        OpenMenu, // a session runs before its planned end; the platform opens the menu
        Ignored, // nothing sent: no account, no state read yet, or an action waits for its answer or its outcome
    };
    Q_ENUM(Activation)

    // None of these is owned; all must outlive the session. state must be the
    // one the timer reads.
    PomodoroSession(Clock &clock, TimerActions &timer, SessionState &state, PomodoroStore &store, QObject *parent = nullptr);

    bool pomodoroMode() const;
    // False, changing nothing, while modeLocked or when the store refuses.
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

    // Minutes do not wrap at 60. Negative seconds read as zero.
    static QString formatCountdown(qint64 seconds, bool overtime);

    PrimaryAction primaryAction() const;
    Q_INVOKABLE Activation activate();
    // True when a request was sent.
    Q_INVOKABLE bool startSession();
    Q_INVOKABLE bool confirmNextPhase();
    Q_INVOKABLE bool endSession();
    Q_INVOKABLE void clearMessage();

Q_SIGNALS:
    void modeChanged();
    void modeLockedChanged();
    void sessionChanged();
    void countdownChanged();
    void ringingChanged();
    void canStartSessionChanged();
    void messageChanged();

private:
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
    // An action is on its way, or its outcome is not known yet.
    bool busy() const;
    bool sendWithRevision(void (SessionState::*action)(SessionState::ActionCallback));
    SessionState::ActionCallback finishing();
    void onStateChanged();
    void onAccountReset();
    // Takes the stored mode even while the mode is locked.
    void reloadMode();
    void update();
    void updateClock();
    void setMessage(const QString &message);

    TimerActions &m_timer;
    SessionState &m_client;
    PomodoroStore &m_store;

    bool m_pomodoroMode;
    bool m_pending = false; // an action waits for its answer
    // An answer to an action sent before accountReset() is ignored.
    Epoch m_epoch;
    QString m_message;
    // So a state seen twice reports the discard once.
    qint64 m_discardedEntry = 0;
    // Keeps ringing until a state shows another phase, even if the clock is set
    // back.
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
