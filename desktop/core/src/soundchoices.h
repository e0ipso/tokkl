#pragma once

#include "apitypes.h"

#include <QObject>
#include <QPointer>
#include <QSettings>
#include <QString>

#include <functional>

namespace Tokkl
{

// The sound each Pomodoro transition plays, kept in a companion's QSettings
// file as a catalogue id. Each companion names its keys its own way, so the
// key of a transition is a parameter; files written by earlier versions read
// the same. A missing or unknown id reads as the transition's default.
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
    // Stores soundId for kind and syncs the file. When the file cannot be
    // written, the earlier choice stays, also in memory, and it returns
    // false. soundId must be a catalogue id.
    bool choose(TransitionKind kind, const QString &soundId);

Q_SIGNALS:
    // choose() changed a stored choice.
    void changed();

private:
    QPointer<QSettings> m_settings;
    KeyFor m_keyFor;
};

}
