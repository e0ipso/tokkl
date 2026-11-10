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

// The parts and their order are shared rules; the words are each panel's.
enum class StatusPart {
    // "Running 0:12"
    Activity,
    // "Work · 4:10 left · Pomodoro 1 of 4"
    Session,
    Project,
    Connection,
    // Why the connection is not ready, or how to set the account up.
    Detail,
    PomodoroMode,
    Message,
};

// How the panel's short text ends.
enum class StatusMark {
    None,
    Pending,
    // Offline, a refused sign-in or an error.
    Alert,
    Unconfigured,
};

// Every panel keys its words on these lists, and its tests fail when a key
// has no word: GNOME reads statuspresentation.json, KDE and macOS read these.
QString statusPartKey(StatusPart part);
QStringList statusPartKeys();
QString statusMarkKey(StatusMark mark);
QStringList statusMarkKeys();
// As tokkl-timerd publishes it in Status.
QString timerStatusKey(TimerModel::Status status);
QStringList timerStatusKeys();
QString primaryActionKey(PrimaryAction action);
QStringList primaryActionKeys();
PrimaryAction primaryActionOf(const TimerModel &timer, const PomodoroSession *session);

struct StatusInput {
    TimerModel::Status status = TimerModel::Unconfigured;
    bool hasDetail = false;
    bool paused = false;
    // A session is active and no timer runs or is paused.
    bool showsSession = false;
    bool pomodoroMode = false;
    bool hasMessage = false;

    bool operator==(const StatusInput &other) const = default;

    // A null session reads as Timer mode with no session.
    static StatusInput of(const TimerModel &timer, const PomodoroSession *session, bool hasMessage = false);
};

// Each companion names its own policy, so a difference lives here rather
// than in one panel's copy of the rules.
struct StatusPolicy {
    enum class SessionConnection {
        Never,
        UnlessReady,
        Always,
    };

    // The tooltip, or the GNOME button's accessible name.
    SessionConnection summarySessionConnection = SessionConnection::UnlessReady;
    bool summarySessionProject = false;
    bool summarySessionDetail = false;
    bool summaryMessage = false;
    SessionConnection menuSessionConnection = SessionConnection::UnlessReady;
    bool menuActivityOnlyWhilePaused = false;
    bool sessionMarksAlertOnly = false;

    // KDE shows a connection that is not ready only as a symbol, so the summary
    // and menu line name it during a session.
    static StatusPolicy plasma();
    static StatusPolicy macos();
    static StatusPolicy gnome();
};

struct StatusPresentation {
    // The tooltip and the GNOME button's accessible name.
    QList<StatusPart> summary;
    QList<StatusPart> menuLine;
    // For a button whose accessible name is the session's line during a session
    // (KDE): there, what that line leaves out.
    QList<StatusPart> accessible;
    StatusMark mark = StatusMark::None;

    bool operator==(const StatusPresentation &other) const = default;

    static StatusPresentation of(const StatusInput &input, const StatusPolicy &policy);
    // The GNOME service's Presentation property, which has no accessible list.
    QVariantMap toVariantMap() const;
};

// Uses the KDE panel's policy. hasMessage is the panel's to set.
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
    Q_PROPERTY(bool showsSession READ showsSession NOTIFY changed)
    Q_PROPERTY(QString action READ action NOTIFY changed)
    Q_PROPERTY(QString status READ status NOTIFY changed)
    Q_PROPERTY(QStringList partKeys READ partKeys CONSTANT)
    Q_PROPERTY(QStringList statusKeys READ statusKeys CONSTANT)
    Q_PROPERTY(QStringList actionKeys READ actionKeys CONSTANT)

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
    QString action() const;
    QString status() const;
    static QStringList partKeys();
    static QStringList statusKeys();
    static QStringList actionKeys();

Q_SIGNALS:
    void timerChanged();
    void sessionChanged();
    void hasMessageChanged();
    void changed();

private:
    void watch();
    void update();

    QPointer<TimerModel> m_timer;
    QPointer<PomodoroSession> m_session;
    bool m_hasMessage = false;
    StatusPresentation m_presentation;
    bool m_showsSession = false;
    QString m_action;
    QString m_status;
    QList<QMetaObject::Connection> m_watches;
};

}
