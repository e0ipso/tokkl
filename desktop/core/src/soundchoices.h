#pragma once

#include "apitypes.h"

#include <QObject>
#include <QPointer>
#include <QSettings>
#include <QString>

#include <functional>

namespace Tokkl
{

// Each companion names its keys its own way, so keyFor is a parameter. A
// missing or unknown id reads as the transition's default.
class SoundChoices : public QObject
{
    Q_OBJECT

public:
    using KeyFor = std::function<QString(TransitionKind)>;

    // settings is not owned. With null settings every transition plays its
    // default and choose() fails.
    SoundChoices(QSettings *settings, KeyFor keyFor, QObject *parent = nullptr);

    QString key(TransitionKind kind) const;
    QString chosen(TransitionKind kind) const;
    // False when the file cannot be written; the earlier choice then stays, also
    // in memory. soundId must be a catalogue id.
    bool choose(TransitionKind kind, const QString &soundId);

Q_SIGNALS:
    void changed();

private:
    QPointer<QSettings> m_settings;
    KeyFor m_keyFor;
};

}
