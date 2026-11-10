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

// Members are destroyed in reverse: the session before the timer it acts
// through, and the connection last.
class TimerStack : public QObject
{
    Q_OBJECT

public:
    // Nothing given is owned, and all of it must outlive the stack.
    TimerStack(Transport *transport,
               CredentialStore *credentials,
               PomodoroStore &pomodoroStore,
               Clock &clock,
               const QString &clientName,
               QObject *parent = nullptr);
    ~TimerStack() override;

    Connection *connection();
    TimerController *timer();
    PomodoroPreferences *preferences();
    PomodoroSession *session();

private:
    Connection m_connection;
    TimerStateClient m_stateClient;
    TimerController m_timer;
    PomodoroPreferences m_preferences;
    PomodoroSession m_session;
};

}
