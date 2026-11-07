#pragma once

// The Pomodoro session as the KDE widget creates it from QML. The core's
// PomodoroSession takes its clock, timer, the timer's state client and the
// store when it is built, and QML can only set properties after an object
// exists, so this type takes the timer and the store as properties and
// builds the session and the preferences client itself.

#include "clock.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"

#include <QObject>
#include <QPointer>
#include <QQmlParserStatus>

namespace Tokkl
{

// Builds the preferences client and the session, both owned here, once
// timer and store are set and the timer has a state client. The session
// acts through that client, the one the timer reads, on its clock, and the
// preferences client uses its connection. Created from a QML document it
// waits for the document to complete, because the session reads the stored
// mode when it is built and the store's own bindings, such as its applet,
// may evaluate after this type's. Another timer, store or state client
// builds both again; the widget never does that. The old ones are deleted
// on the next event loop pass, so QML never reads a deleted object. The
// session and the preferences are null until then.
class KdePomodoro : public QObject, public QQmlParserStatus
{
    Q_OBJECT
    Q_INTERFACES(QQmlParserStatus)

    Q_PROPERTY(Tokkl::TimerController *timer READ timer WRITE setTimer NOTIFY timerChanged)
    Q_PROPERTY(Tokkl::PomodoroStore *store READ store WRITE setStore NOTIFY storeChanged)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session NOTIFY sessionChanged)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences NOTIFY sessionChanged)

public:
    explicit KdePomodoro(QObject *parent = nullptr);

    TimerController *timer() const;
    void setTimer(TimerController *timer);
    PomodoroStore *store() const;
    void setStore(PomodoroStore *store);

    PomodoroSession *session() const;
    PomodoroPreferences *preferences() const;

    void classBegin() override;
    void componentComplete() override;

Q_SIGNALS:
    void timerChanged();
    void storeChanged();
    void sessionChanged();

private:
    void build();
    // The session and the preferences go, from the next event loop pass, as
    // QML may still read them in this one. They stop following the timer
    // and the client at once.
    void release();

    QPointer<TimerController> m_timer;
    QPointer<PomodoroStore> m_store;
    PomodoroPreferences *m_preferences = nullptr;
    PomodoroSession *m_session = nullptr;
    // The client and store the session was built on.
    QPointer<TimerStateClient> m_client;
    QPointer<PomodoroStore> m_builtStore;
    // Between classBegin() and componentComplete().
    bool m_inDocument = false;
};

}
