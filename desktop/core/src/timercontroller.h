#pragma once

#include "timercoordinator.h"
#include "timermodel.h"

#include <QVariant>

namespace Tokkl
{

// The timer as one object, for QML (TokklTimer) and the panels: the
// TimerModel it is, which shows the timer, and the TimerCoordinator it owns,
// which acts. Its properties are the model's; its actions and slots go to
// the coordinator, which holds the rules (see timercoordinator.h). A panel
// that keeps reading and acting apart takes model() and coordinator().
class TimerController : public TimerModel
{
    Q_OBJECT

    // Not owned. The connection is the client's.
    Q_PROPERTY(Tokkl::TimerStateClient *stateClient READ stateClient CONSTANT)

public:
    // Reads and acts through the given client, and runs on its clock. The
    // client is not owned and must outlive the controller.
    explicit TimerController(TimerStateClient &client, QObject *parent = nullptr);
    ~TimerController() override;

    TimerModel *model();
    TimerCoordinator *coordinator() const;

    // See TimerCoordinator. The actions return true when a request was
    // sent.
    Q_INVOKABLE bool start();
    Q_INVOKABLE bool stop();
    Q_INVOKABLE bool pause();
    Q_INVOKABLE bool resume();
    Q_INVOKABLE bool toggle();
    Q_INVOKABLE bool chooseProject(const QVariant &projectId);
    Q_INVOKABLE bool chooseBillable(bool billable);

public Q_SLOTS:
    // A panel opens its menu: checks whether the projects changed; see
    // TimerCoordinator::refreshProjects().
    void refreshProjects();
    // Explicit reconnect: lifts a workspace block and revalidates the account.
    void reconnect();

private:
    TimerCoordinator *m_coordinator;
};

}
