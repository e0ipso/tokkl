#include "soundchoices.h"

#include "logging.h"
#include "pomodorosounds.h"

#include <utility>

namespace Tokkl
{

SoundChoices::SoundChoices(QSettings *settings, KeyFor keyFor, QObject *parent)
    : QObject(parent)
    , m_settings(settings)
    , m_keyFor(std::move(keyFor))
{
}

QString SoundChoices::key(TransitionKind kind) const
{
    return m_keyFor(kind);
}

QString SoundChoices::chosen(TransitionKind kind) const
{
    return chosenSound(m_settings ? m_settings->value(key(kind)).toString() : QString(), kind);
}

bool SoundChoices::choose(TransitionKind kind, const QString &soundId)
{
    if (!m_settings || !isSoundId(soundId)) {
        return false;
    }
    const QString name = key(kind);
    const QVariant before = m_settings->value(name);
    m_settings->setValue(name, soundId);
    m_settings->sync();
    if (m_settings->status() != QSettings::NoError) {
        qCWarning(lcAlarm) << "Could not save the sound choice to" << m_settings->fileName();
        if (before.isValid()) {
            m_settings->setValue(name, before);
        } else {
            m_settings->remove(name);
        }
        return false;
    }
    if (before.toString() != soundId) {
        Q_EMIT changed();
    }
    return true;
}

}
