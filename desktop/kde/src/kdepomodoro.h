#pragma once

// The Pomodoro session as the KDE widget creates it from QML. The core's
// PomodoroSession takes its clock, timer, preferences client, queue and
// store when it is built, and QML can only set properties after an object
// exists, so this type takes the connection, the timer and the store as
// properties and builds the rest itself.

#include "clock.h"
#include "connection.h"
#include "pomodoropreferences.h"
#include "pomodoroqueue.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"

#include <QObject>
#include <QPointer>
#include <QQmlParserStatus>

namespace Tokkl
{

// Builds the preferences client, the save queue and the session, all owned
// here and sharing one system clock, once connection, timer and store are
// set. Created from a QML document it waits for the document to complete,
// because the session reads the stored mode when it is built and the
// store's own bindings, such as its applet, may evaluate after this type's.
// A property set again afterwards builds everything again; the widget never
// does that. The session and the preferences are null until then.
class KdePomodoro : public QObject, public QQmlParserStatus
{
    Q_OBJECT
    Q_INTERFACES(QQmlParserStatus)

    Q_PROPERTY(Tokkl::Connection *connection READ connection WRITE setConnection NOTIFY connectionChanged)
    Q_PROPERTY(Tokkl::TimerController *timer READ timer WRITE setTimer NOTIFY timerChanged)
    Q_PROPERTY(Tokkl::PomodoroStore *store READ store WRITE setStore NOTIFY storeChanged)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session NOTIFY sessionChanged)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences NOTIFY sessionChanged)

public:
    explicit KdePomodoro(QObject *parent = nullptr);

    Connection *connection() const;
    void setConnection(Connection *connection);
    TimerController *timer() const;
    void setTimer(TimerController *timer);
    PomodoroStore *store() const;
    void setStore(PomodoroStore *store);

    PomodoroSession *session() const;
    PomodoroPreferences *preferences() const;

    void classBegin() override;
    void componentComplete() override;

Q_SIGNALS:
    void connectionChanged();
    void timerChanged();
    void storeChanged();
    void sessionChanged();

private:
    void build();

    SystemClock m_clock;
    QPointer<Connection> m_connection;
    QPointer<TimerController> m_timer;
    QPointer<PomodoroStore> m_store;
    PomodoroPreferences *m_preferences = nullptr;
    PomodoroQueue *m_queue = nullptr;
    PomodoroSession *m_session = nullptr;
    // Between classBegin() and componentComplete().
    bool m_inDocument = false;
};

}
