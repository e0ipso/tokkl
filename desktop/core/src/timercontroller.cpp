#include "timercontroller.h"

namespace Tokkl
{

TimerController::TimerController(TimerStateClient &client, QObject *parent)
    : TimerModel(client, parent)
    , m_coordinator(new TimerCoordinator(this, roles(), client, this))
{
    setActivity(m_coordinator);
}

TimerController::~TimerController()
{
    // The model stops reading the coordinator before it goes.
    setActivity(nullptr);
    delete m_coordinator;
}

TimerModel *TimerController::model()
{
    return this;
}

TimerCoordinator *TimerController::coordinator() const
{
    return m_coordinator;
}

bool TimerController::start()
{
    return m_coordinator->start();
}

bool TimerController::stop()
{
    return m_coordinator->stop();
}

bool TimerController::pause()
{
    return m_coordinator->pause();
}

bool TimerController::resume()
{
    return m_coordinator->resume();
}

bool TimerController::toggle()
{
    return m_coordinator->toggle();
}

bool TimerController::chooseProject(const QVariant &projectId)
{
    return m_coordinator->chooseProject(projectId);
}

bool TimerController::chooseBillable(bool billable)
{
    return m_coordinator->chooseBillable(billable);
}

void TimerController::refreshProjects()
{
    m_coordinator->refreshProjects();
}

void TimerController::resumed()
{
    m_coordinator->resumed();
}

void TimerController::reconnect()
{
    m_coordinator->reconnect();
}

}
