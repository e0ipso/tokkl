#pragma once

// Words for the timer's and the Pomodoro session's state, shared by the menu
// bar item, its tooltip and the menu. Every state has its own text, so
// nothing depends on color.

#include "pomodorosession.h"
#include "timercontroller.h"

#include <QString>
#include <QVariantMap>

namespace Tokkl::StatusWords
{

// Running, Paused or Stopped.
QString runText(const TimerController &timer);
QString statusText(TimerController::Status status);
// A longer explanation of the status, or an empty string.
QString detailText(const TimerController &timer);
// A project map from TimerController: its name, client and archived state.
QString projectLabel(const QVariantMap &project);
// The project the menu shows: the running or paused entry's, or the next
// start's.
QString projectText(const TimerController &timer);
// One line for the tooltip: run state, elapsed time, project and status.
QString summary(const TimerController &timer);
// The menu bar text: the elapsed time, with a mark when the timer is not
// ready, or the app name before it is configured.
QString menuBarTitle(const TimerController &timer);
// What the item does on a primary click, for screen readers: pause, resume
// or start.
QString actionName(const TimerController &timer);
// What a screen reader announces for the menu bar item: the action and the
// project, so the project never depends on the indicator's colour.
QString itemName(const TimerController &timer);

// Work, Short rest or Long rest for a phase as PomodoroSession names it;
// empty for anything else.
QString phaseName(const QString &phase);
// The session in one line: the phase, the time left or the overtime, and
// the pomodoro of the round, such as "Short rest · 4:10 left · Pomodoro 2 of
// 4".
QString sessionText(const PomodoroSession &session);
// The item shows the session rather than the timer: a session is active and
// no timer runs or is paused.
bool showsSession(const TimerController &timer, const PomodoroSession &session);
// The tooltip with the session: sessionText while showsSession, otherwise
// the timer's summary, with " · Pomodoro mode" in Pomodoro mode.
QString summary(const TimerController &timer, const PomodoroSession &session);
// The menu bar text with the session: the session's countdown while
// showsSession, otherwise the timer's.
QString menuBarTitle(const TimerController &timer, const PomodoroSession &session);
// The screen reader's name with the session: sessionText while
// showsSession, otherwise the timer's, with " · Pomodoro mode" in Pomodoro
// mode, where a click with no timer starts a session.
QString itemName(const TimerController &timer, const PomodoroSession &session);

}
