#pragma once

// Every state has its own words, so nothing depends on color.

#include "pomodorosession.h"
#include "timermodel.h"

#include <QString>
#include <QStringList>
#include <QVariantMap>

#include <optional>

namespace Tokkl::StatusWords
{

// Keyed on the core's keys (statuspresentation.h). Each returns nothing for
// an unknown key, so the tests find a core key without words.
QString runText(const TimerModel &timer);
QString statusWord(const QString &status);
QString statusText(TimerModel::Status status);
QString detailText(const TimerModel &timer);
QString projectLabel(const ProjectLabelParts &parts);
QString projectText(const TimerModel &timer);
QString actionName(const QString &action, const PomodoroSession &session);

QString phaseName(const QString &phase);
QString sessionText(const PomodoroSession &session);
// nullopt for an unknown part key. "message" adds nothing: the menu shows
// the session's message on its own line.
std::optional<QStringList> withPart(const QString &part, QStringList words, const TimerModel &timer, const PomodoroSession &session);

// The tooltip.
QString summary(const TimerModel &timer, const PomodoroSession &session);
QString menuLine(const TimerModel &timer, const PomodoroSession &session);
QString menuBarTitle(const TimerModel &timer, const PomodoroSession &session);
// The accessible name. It always names the project, so the project never
// depends on the indicator's colour.
QString itemName(const TimerModel &timer, const PomodoroSession &session);

}
