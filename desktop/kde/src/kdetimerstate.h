#pragma once

// The widget's timer as QML creates it: the core's TimerStack on the
// network, KDE Wallet and one system clock, with the Pomodoro mode in the
// applet's configuration.

#include "appletpomodorostore.h"
#include "clock.h"
#include "timerstack.h"
#include "transport.h"

#include <QObject>

namespace Tokkl
{

// Builds the connection, the timer state client, the timer, the Pomodoro
// preferences client and the Pomodoro session when it is created, so none
// of them is ever null in QML, and owns them. QML configures the connection
// through its grouped properties (connection.instanceUrl and the others)
// and hands over the applet, whose configuration keeps the Pomodoro mode;
// the session takes the mode stored there once the applet is set.
class KdeTimerState : public QObject
{
    Q_OBJECT

    // The Plasma::Applet, the widget's Plasmoid.
    Q_PROPERTY(QObject *applet READ applet WRITE setApplet NOTIFY appletChanged)
    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)
    Q_PROPERTY(Tokkl::TimerController *timer READ timer CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences CONSTANT)

public:
    explicit KdeTimerState(QObject *parent = nullptr);
    ~KdeTimerState() override;

    QObject *applet() const;
    void setApplet(QObject *applet);

    Connection *connection();
    TimerController *timer();
    PomodoroSession *session();
    PomodoroPreferences *preferences();

Q_SIGNALS:
    void appletChanged();

private:
    // Declared before the stack, so they go after it.
    SystemClock m_clock;
    NetworkTransport m_transport;
    AppletPomodoroStore m_pomodoroStore;
    TimerStack m_stack;
};

}
