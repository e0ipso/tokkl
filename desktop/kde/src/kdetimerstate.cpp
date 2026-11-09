#include "kdetimerstate.h"

#include "kdeconnection.h"
#include "kwalletcredentialstore.h"

namespace Tokkl
{

KdeTimerState::KdeTimerState(QObject *parent)
    : QObject(parent)
    , m_transport(kdeClientName())
    , m_stack(&m_transport, KWalletCredentialStore::shared(), m_pomodoroStore, m_clock, kdeClientName())
{
    connect(&m_pomodoroStore, &AppletPomodoroStore::appletChanged, this, &KdeTimerState::appletChanged);
}

KdeTimerState::~KdeTimerState() = default;

QObject *KdeTimerState::applet() const
{
    return m_pomodoroStore.applet();
}

void KdeTimerState::setApplet(QObject *applet)
{
    m_pomodoroStore.setApplet(applet);
}

Connection *KdeTimerState::connection()
{
    return m_stack.connection();
}

TimerController *KdeTimerState::timer()
{
    return m_stack.timer();
}

PomodoroSession *KdeTimerState::session()
{
    return m_stack.session();
}

PomodoroPreferences *KdeTimerState::preferences()
{
    return m_stack.preferences();
}

}
