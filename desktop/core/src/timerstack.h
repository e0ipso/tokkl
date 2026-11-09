#pragma once

#include "clock.h"
#include "connection.h"
#include "credentialstore.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstateclient.h"
#include "transport.h"

#include <QObject>
#include <QString>

namespace Tokkl
{

// The objects behind one companion's timer, built and wired the same way on
// every platform: the connection, the one TimerStateClient that reads the
// server's timer state, the timer controller on that client, the Pomodoro
// preferences client, and the Pomodoro session, which reads and acts
// through the timer's client. All of them run on the one clock given. The
// timer has its client before the session is built, as the session reads
// the timer's state when it starts.
//
// The objects are children of the stack and live as long as it does. They
// go in the reverse order: the session before the timer it acts through,
// and the connection last.
class TimerStack : public QObject
{
    Q_OBJECT

public:
    // Nothing given is owned, and all of it must outlive the stack.
    // pomodoroStore keeps the Pomodoro mode across restarts; without one the
    // mode is not kept. clientName goes into the created_with field of the
    // entries the connection starts.
    TimerStack(Transport *transport,
               CredentialStore *credentials,
               PomodoroStore *pomodoroStore,
               Clock &clock,
               const QString &clientName,
               QObject *parent = nullptr);
    ~TimerStack() override;

    Connection *connection();
    // The timer reads its state client, which stateClient() on it returns.
    TimerController *timer();
    PomodoroPreferences *preferences();
    PomodoroSession *session();

private:
    // Gives the timer its client and returns its coordinator, for the
    // session.
    TimerCoordinator *boundTimer();

    Connection m_connection;
    TimerStateClient m_stateClient;
    TimerController m_timer;
    PomodoroPreferences m_preferences;
    PomodoroSession m_session;
};

}
