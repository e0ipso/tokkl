#pragma once

#include "appletpomodorostore.h"
#include "clock.h"
#include "timerstack.h"
#include "transport.h"

#include <QObject>

namespace Tokkl
{

// Builds everything in the constructor so no property is ever null in QML.
class KdeTimerState : public QObject
{
    Q_OBJECT

    // A Plasma::Applet.
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
