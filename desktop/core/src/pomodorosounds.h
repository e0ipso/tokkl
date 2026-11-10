#pragma once

#include "apitypes.h"

#include <QList>
#include <QString>
#include <QStringView>

#include <optional>

namespace Tokkl
{

// The four sounds the web app and Android bundle. Each transition plays its
// namesake until the user picks another.
struct PomodoroSound {
    // Stored for the user's choice, e.g. "work-to-short-rest".
    QString id;
    QString label;
    // pomodoro-<id>.wav
    QString fileName;

    bool operator==(const PomodoroSound &other) const = default;
};

// In the order the settings panes list them.
QList<PomodoroSound> pomodoroSounds();

std::optional<PomodoroSound> pomodoroSound(QStringView id);
bool isSoundId(QStringView id);

QString defaultSound(TransitionKind kind);

// stored when it is a catalogue id, else the default for kind.
QString chosenSound(QStringView stored, TransitionKind kind);

// Empty for an unknown id or a missing file.
QString soundFile(const QString &directory, QStringView soundId);

}
