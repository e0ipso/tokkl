#pragma once

// Words for the timer's and the Pomodoro session's state, shared by the menu
// bar item, its tooltip and the menu. Every state has its own text, so
// nothing depends on color.

#include "pomodorosession.h"
#include "timermodel.h"

#include <QString>
#include <QStringList>
#include <QVariantMap>

#include <optional>

namespace Tokkl::StatusWords
{

// The words are keyed on the core's keys (statuspresentation.h): the
// timer's status by timerStatusKey(), the primary click by
// primaryActionKey() and the parts by statusPartKey(). Each gives nothing
// for a key it does not know, so the tests find a core key without words.

// Running, Paused or Stopped.
QString runText(const TimerModel &timer);
// The connection's state for a status key; empty for any other key.
QString statusWord(const QString &status);
QString statusText(TimerModel::Status status);
// A longer explanation of the status, or an empty string.
QString detailText(const TimerModel &timer);
// A project id from TimerModel, such as chosenProjectId: null, or
// unset, for no project.
bool isNoProject(const QVariant &id);
// The words for the parts of a project's label: "Name (Client)", then
// "(archived)", or "Unavailable project" for one the instance no longer has.
QString projectLabel(const ProjectLabelParts &parts);
// The project the menu shows, TimerModel::chosenProjectLabel(): the
// running or paused entry's, or the next start's.
QString projectText(const TimerModel &timer);
// What the item does on a primary click, for screen readers, for an action
// key: pause, resume, start the timer or start a session, and the session's
// line while the click acts on the session. Empty for any other key.
QString actionName(const QString &action, const PomodoroSession &session);

// Work, Short rest or Long rest for a phase as PomodoroSession names it;
// empty for anything else.
QString phaseName(const QString &phase);
// The session in one line: the phase, the time left or the overtime, and
// the pomodoro of the round, such as "Short rest · 4:10 left · Pomodoro 2 of
// 4".
QString sessionText(const PomodoroSession &session);
// The words so far with the part named by a part key added; nullopt for
// any other key. "pomodoroMode" marks the words so far, and "message" adds
// nothing, as the menu shows the session's message on a line of its own.
std::optional<QStringList> withPart(const QString &part, QStringList words, const TimerModel &timer, const PomodoroSession &session);

// The words follow the core's StatusPresentation with the macOS policy;
// these turn its parts into words.
//
// showsSession below is StatusInput::showsSession: a session is active and
// no timer runs or is paused.
//
// The tooltip: the session's line, with the connection's state unless it is
// ready, while showsSession; otherwise the run state and elapsed time, the
// project, the connection's state and its detail, with " · Pomodoro mode"
// in Pomodoro mode.
QString summary(const TimerModel &timer, const PomodoroSession &session);
// The menu's state line: the session's line, with the connection's state
// unless it is ready, while showsSession, such as "Work · 4:10 left ·
// Pomodoro 2 of 4 · Offline, showing the last known state"; otherwise the
// run state, the elapsed time and the connection's state.
QString menuLine(const TimerModel &timer, const PomodoroSession &session);
// The menu bar text: the session's countdown while showsSession, otherwise
// the elapsed time, with " …" while loading or saving and " !" when the
// instance is offline, refusing the sign-in or failing; the app name before
// an account is set up. The countdown is marked only by " !".
QString menuBarTitle(const TimerModel &timer, const PomodoroSession &session);
// What a screen reader announces for the menu bar item: sessionText while
// the click acts on the session, otherwise the click's action and the
// project, so the project never depends on the indicator's colour, with
// " · Pomodoro mode" in Pomodoro mode, where a click with no timer starts a
// session.
QString itemName(const TimerModel &timer, const PomodoroSession &session);

}
