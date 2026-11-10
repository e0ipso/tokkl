#pragma once

#include <QObject>
#include <QString>
#include <QVariantList>

namespace Tokkl
{

class PomodoroSoundCatalogue : public QObject
{
    Q_OBJECT

    // Maps with id, label and fileName.
    Q_PROPERTY(QVariantList sounds READ sounds CONSTANT)

public:
    explicit PomodoroSoundCatalogue(QObject *parent = nullptr);

    QVariantList sounds() const;
    Q_INVOKABLE QString defaultSound(const QString &transition) const;
    Q_INVOKABLE QString label(const QString &soundId) const;
    Q_INVOKABLE bool isSoundId(const QString &soundId) const;
};

}
