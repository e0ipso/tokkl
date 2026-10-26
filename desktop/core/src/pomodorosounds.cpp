#include "pomodorosounds.h"

#include <QCoreApplication>

namespace Tokkl
{

namespace
{
struct Entry {
    TransitionKind transition;
    const char *id;
    // The sound as docs/sounds/README.md describes it.
    const char *label;
};

constexpr Entry entries[] = {
    {TransitionKind::WorkToShortRest, "work-to-short-rest", QT_TRANSLATE_NOOP("Tokkl::PomodoroSounds", "Two falling notes")},
    {TransitionKind::ShortRestToWork, "short-rest-to-work", QT_TRANSLATE_NOOP("Tokkl::PomodoroSounds", "Three rising notes")},
    {TransitionKind::WorkToLongRest, "work-to-long-rest", QT_TRANSLATE_NOOP("Tokkl::PomodoroSounds", "Four slow falling notes")},
    {TransitionKind::LongRestToWork, "long-rest-to-work", QT_TRANSLATE_NOOP("Tokkl::PomodoroSounds", "Fast high run")},
};
}

QList<PomodoroSound> pomodoroSounds()
{
    QList<PomodoroSound> sounds;
    for (const Entry &entry : entries) {
        const QString id = QLatin1String(entry.id);
        sounds.append(PomodoroSound{
            id,
            QCoreApplication::translate("Tokkl::PomodoroSounds", entry.label),
            QStringLiteral("pomodoro-") + id + QStringLiteral(".wav"),
        });
    }
    return sounds;
}

std::optional<PomodoroSound> pomodoroSound(QStringView id)
{
    for (const PomodoroSound &sound : pomodoroSounds()) {
        if (sound.id == id) {
            return sound;
        }
    }
    return std::nullopt;
}

bool isSoundId(QStringView id)
{
    return pomodoroSound(id).has_value();
}

QString defaultSound(TransitionKind kind)
{
    for (const Entry &entry : entries) {
        if (entry.transition == kind) {
            return QLatin1String(entry.id);
        }
    }
    return QString();
}

}
