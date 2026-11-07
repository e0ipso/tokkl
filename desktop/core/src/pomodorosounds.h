#pragma once

#include "apitypes.h"

#include <QList>
#include <QString>
#include <QStringView>

#include <optional>

namespace Tokkl
{

// The sounds a Pomodoro transition can play: the four the web app and
// Android bundle, each named after the transition it marks there. Every
// transition plays its namesake until the user picks another sound for it.
// The companions install the files TOKKL_POMODORO_SOUND_FILES lists.
struct PomodoroSound {
    // What the platforms store for the user's choice, for example
    // "work-to-short-rest".
    QString id;
    // What the sound is like, for the settings panes.
    QString label;
    // The installed file, pomodoro-<id>.wav.
    QString fileName;

    bool operator==(const PomodoroSound &other) const = default;
};

// The four sounds in the order the settings panes list them.
QList<PomodoroSound> pomodoroSounds();

// The sound with this id, or nullopt for an id the catalogue does not have.
std::optional<PomodoroSound> pomodoroSound(QStringView id);
bool isSoundId(QStringView id);

// The id of the sound named after kind.
QString defaultSound(TransitionKind kind);

// The sound a transition plays: stored when it is a catalogue id, else the
// default for kind. Every platform stores the user's choice under its own
// key and reads it through this.
QString chosenSound(QStringView stored, TransitionKind kind);

// The file of a catalogue sound in directory, or empty for an id the
// catalogue does not have or a file that is not there.
QString soundFile(const QString &directory, QStringView soundId);

}
