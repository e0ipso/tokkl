#pragma once

#include "timermodel.h"

#include <QList>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QStringList>
#include <QVariantMap>

namespace Tokkl
{

class PomodoroSession;

// What a panel puts in its words for the timer's and the session's state,
// in order, as keys a panel turns into its own words. The parts and their
// order are the same rules on every panel; the words are each panel's.
enum class StatusPart {
    // The run state and the elapsed time, such as "Running 0:12".
    Activity,
    // The session in one line, such as "Work · 4:10 left · Pomodoro 1 of 4".
    Session,
    // The project shown.
    Project,
    // The connection's state, such as "Offline, showing the last known
    // state".
    Connection,
    // Why the connection is not ready, or how to set the account up.
    Detail,
    // "Pomodoro mode".
    PomodoroMode,
    // The panel's message, such as a pomodoro too short to save.
    Message,
};

// How the panel's short text, the elapsed time or the countdown, ends.
enum class StatusMark {
    None,
    // Loading or saving.
    Pending,
    // The timer shown cannot be trusted or used: offline, a refused sign-in
    // or an error.
    Alert,
    // No account is set up.
    Unconfigured,
};

// "activity", "session", "project", "connection", "detail", "pomodoroMode"
// or "message".
QString statusPartKey(StatusPart part);
// "none", "pending", "alert" or "unconfigured".
QString statusMarkKey(StatusMark mark);

// What the presentation reads of the timer and the session.
struct StatusInput {
    TimerModel::Status status = TimerModel::Unconfigured;
    // A detail exists: how to set the account up while unconfigured, or the
    // reason the connection is not ready.
    bool hasDetail = false;
    bool paused = false;
    // A session is active and no timer runs or is paused.
    bool showsSession = false;
    bool pomodoroMode = false;
    // The panel has a message to show.
    bool hasMessage = false;

    bool operator==(const StatusInput &other) const = default;

    // A null session reads as Timer mode with no session.
    static StatusInput of(const TimerModel &timer, const PomodoroSession *session, bool hasMessage = false);
};

// Where the panels' words differ. Each companion names its own policy, so a
// difference is written here rather than in one panel's copy of the rules.
struct StatusPolicy {
    // Whether a session's line names the connection.
    enum class SessionConnection {
        Never,
        UnlessReady,
        Always,
    };

    // The summary: the tooltip, or the GNOME button's accessible name.
    SessionConnection summarySessionConnection = SessionConnection::UnlessReady;
    // During a session the summary names the project, and the detail after
    // the connection.
    bool summarySessionProject = false;
    bool summarySessionDetail = false;
    // The summary ends with the panel's message.
    bool summaryMessage = false;
    // The menu's state line.
    SessionConnection menuSessionConnection = SessionConnection::UnlessReady;
    // The menu's state line names the run state and elapsed time only while
    // paused; otherwise always.
    bool menuActivityOnlyWhilePaused = false;
    // During a session only an alert marks the countdown.
    bool sessionMarksAlertOnly = false;

    // The KDE panel: the summary and the menu line name a connection that
    // is not ready during a session, as the panel shows it otherwise only
    // as a symbol, and the summary ends with the message.
    static StatusPolicy plasma();
    // The macOS menu bar app: as the KDE panel, without the message, and a
    // session's countdown is marked only for an alert.
    static StatusPolicy macos();
    // The GNOME button: its accessible name always names the project and
    // the connection, during a session too, and its menu line names the
    // connection alone, with the paused total while paused, and the
    // session's line alone during a session.
    static StatusPolicy gnome();
};

// Which parts a panel's words show, in what order, and how its short text
// ends.
struct StatusPresentation {
    // The tooltip and the GNOME button's accessible name.
    QList<StatusPart> summary;
    // The menu's state line.
    QList<StatusPart> menuLine;
    // The accessible description of a button whose accessible name is the
    // session's line during a session, as the KDE panel's is: the summary
    // outside a session, and during one what that line leaves out, the
    // project, then the connection with its detail when the summary would
    // name the connection, then the message when the summary ends with it.
    QList<StatusPart> accessible;
    StatusMark mark = StatusMark::None;

    bool operator==(const StatusPresentation &other) const = default;

    static StatusPresentation of(const StatusInput &input, const StatusPolicy &policy);
    // summary and menuLine as lists of part keys, and mark as its key: the
    // GNOME service's Presentation property, which has no accessible list.
    QVariantMap toVariantMap() const;
};

// StatusPresentation kept up to date for a timer and a session, for QML
// (TokklStatusParts). It uses the KDE panel's policy. hasMessage is the
// panel's to set, as the panel knows its messages.
class StatusParts : public QObject
{
    Q_OBJECT

    // Neither is owned.
    Q_PROPERTY(Tokkl::TimerModel *timer READ timer WRITE setTimer NOTIFY timerChanged)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session WRITE setSession NOTIFY sessionChanged)
    Q_PROPERTY(bool hasMessage READ hasMessage WRITE setHasMessage NOTIFY hasMessageChanged)
    Q_PROPERTY(QStringList summary READ summary NOTIFY changed)
    Q_PROPERTY(QStringList menuLine READ menuLine NOTIFY changed)
    Q_PROPERTY(QStringList accessible READ accessible NOTIFY changed)
    Q_PROPERTY(QString mark READ mark NOTIFY changed)
    // The panel shows the session rather than the timer: a session is
    // active and no timer runs or is paused (StatusInput::showsSession).
    Q_PROPERTY(bool showsSession READ showsSession NOTIFY changed)

public:
    explicit StatusParts(QObject *parent = nullptr);

    TimerModel *timer() const;
    void setTimer(TimerModel *timer);
    PomodoroSession *session() const;
    void setSession(PomodoroSession *session);
    bool hasMessage() const;
    void setHasMessage(bool hasMessage);

    const StatusPresentation &presentation() const;
    QStringList summary() const;
    QStringList menuLine() const;
    QStringList accessible() const;
    QString mark() const;
    bool showsSession() const;

Q_SIGNALS:
    void timerChanged();
    void sessionChanged();
    void hasMessageChanged();
    // The presentation changed.
    void changed();

private:
    void watch();
    void update();

    QPointer<TimerModel> m_timer;
    QPointer<PomodoroSession> m_session;
    bool m_hasMessage = false;
    StatusPresentation m_presentation;
    bool m_showsSession = false;
    QList<QMetaObject::Connection> m_watches;
};

}
