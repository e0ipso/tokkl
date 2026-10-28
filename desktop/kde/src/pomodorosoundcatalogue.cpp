#include "pomodorosoundcatalogue.h"

#include "apitypes.h"
#include "pomodorosounds.h"

#include <QVariantMap>

namespace Tokkl
{

PomodoroSoundCatalogue::PomodoroSoundCatalogue(QObject *parent)
    : QObject(parent)
{
}

QVariantList PomodoroSoundCatalogue::sounds() const
{
    QVariantList list;
    for (const PomodoroSound &sound : pomodoroSounds()) {
        list.append(QVariantMap{
            {QStringLiteral("id"), sound.id},
            {QStringLiteral("label"), sound.label},
            {QStringLiteral("fileName"), sound.fileName},
        });
    }
    return list;
}

QString PomodoroSoundCatalogue::defaultSound(const QString &transition) const
{
    const std::optional<TransitionKind> kind = parseTransitionKind(transition);
    return kind ? Tokkl::defaultSound(*kind) : QString();
}

QString PomodoroSoundCatalogue::label(const QString &soundId) const
{
    const std::optional<PomodoroSound> sound = pomodoroSound(soundId);
    return sound ? sound->label : QString();
}

bool PomodoroSoundCatalogue::isSoundId(const QString &soundId) const
{
    return Tokkl::isSoundId(soundId);
}

}
