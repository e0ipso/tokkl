#pragma once

// Words for the timer's state, shared by the menu bar item, its tooltip and
// the menu. Every state has its own text, so nothing depends on color.

#include "timercontroller.h"

#include <QString>
#include <QVariantMap>

namespace Tokkl::StatusWords
{

QString runText(bool running);
QString statusText(TimerController::Status status);
// A longer explanation of the status, or an empty string.
QString detailText(const TimerController &timer);
// A project map from TimerController: its name, client and archived state.
QString projectLabel(const QVariantMap &project);
// The project the menu shows: the running entry's or the next start's.
QString projectText(const TimerController &timer);
// One line for the tooltip: run state, elapsed time, project and status.
QString summary(const TimerController &timer);
// The menu bar text: the elapsed time, with a mark when the timer is not
// ready, or the app name before it is configured.
QString menuBarTitle(const TimerController &timer);
// What the item does on a primary click, for screen readers.
QString actionName(const TimerController &timer);

}
