#pragma once

// The sound catalogue for the settings page and the alarm: the bundled
// sounds with their ids and labels, and the default sound of each
// transition, as the core's pomodorosounds.h lists them.

#include <QObject>
#include <QString>
#include <QVariantList>

namespace Tokkl
{

class PomodoroSoundCatalogue : public QObject
{
    Q_OBJECT

    // One map per sound, with id, label and fileName, in the order the
    // settings page lists them.
    Q_PROPERTY(QVariantList sounds READ sounds CONSTANT)

public:
    explicit PomodoroSoundCatalogue(QObject *parent = nullptr);

    QVariantList sounds() const;
    // The id of the sound named after the transition ("workToShortRest" and
    // so on); empty for a transition the cycle does not have.
    Q_INVOKABLE QString defaultSound(const QString &transition) const;
    // The label of a sound id, or empty for an id the catalogue lacks.
    Q_INVOKABLE QString label(const QString &soundId) const;
    Q_INVOKABLE bool isSoundId(const QString &soundId) const;
};

}
