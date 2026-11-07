#pragma once

// Words for the timer's and the Pomodoro session's state, shared by the menu
// bar item, its tooltip and the menu. Every state has its own text, so
// nothing depends on color.

#include "pomodorosession.h"
#include "timermodel.h"

#include <QString>
#include <QVariantMap>

namespace Tokkl::StatusWords
{

// Running, Paused or Stopped.
QString runText(const TimerModel &timer);
QString statusText(TimerModel::Status status);
// A longer explanation of the status, or an empty string.
QString detailText(const TimerModel &timer);
// A project id from TimerModel, such as chosenProjectId: null, or
// unset, for no project.
bool isNoProject(const QVariant &id);
// A project map from TimerModel: its name, client and archived state.
QString projectLabel(const QVariantMap &project);
// The project the menu shows: the running or paused entry's, or the next
// start's.
QString projectText(const TimerModel &timer);
// One line for the tooltip: run state, elapsed time, project and status.
QString summary(const TimerModel &timer);
// The menu bar text: the elapsed time, with a mark when the timer is not
// ready, or the app name before it is configured.
QString menuBarTitle(const TimerModel &timer);
// What the item does on a primary click, for screen readers: pause, resume
// or start.
QString actionName(const TimerModel &timer);
// What a screen reader announces for the menu bar item: the action and the
// project, so the project never depends on the indicator's colour.
QString itemName(const TimerModel &timer);

// Work, Short rest or Long rest for a phase as PomodoroSession names it;
// empty for anything else.
QString phaseName(const QString &phase);
// The session in one line: the phase, the time left or the overtime, and
// the pomodoro of the round, such as "Short rest · 4:10 left · Pomodoro 2 of
// 4".
QString sessionText(const PomodoroSession &session);
// sessionText with the timer's status after it unless the timer is Ready, so
// an offline or failing connection shows next to the countdown of the last
// state held, such as "Work · 4:10 left · Pomodoro 2 of 4 · Offline,
// showing the last known state".
QString sessionLine(const TimerModel &timer, const PomodoroSession &session);
// The item shows the session rather than the timer: a session is active and
// no timer runs or is paused.
bool showsSession(const TimerModel &timer, const PomodoroSession &session);
// The tooltip with the session: sessionLine while showsSession, otherwise
// the timer's summary, with " · Pomodoro mode" in Pomodoro mode.
QString summary(const TimerModel &timer, const PomodoroSession &session);
// The menu bar text with the session: the session's countdown while
// showsSession, with " !" after it when the instance is offline, refusing the
// sign-in or failing; otherwise the timer's.
QString menuBarTitle(const TimerModel &timer, const PomodoroSession &session);
// The screen reader's name with the session: sessionText while
// showsSession, otherwise the timer's, with " · Pomodoro mode" in Pomodoro
// mode, where a click with no timer starts a session.
QString itemName(const TimerModel &timer, const PomodoroSession &session);

}
