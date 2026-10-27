#include "alarmplayer.h"

#include "pomodorocycle.h"
#include "pomodorosounds.h"

#include <QFileInfo>
#include <QStandardPaths>

#include <utility>

namespace Tokkl
{

namespace
{
// Stops the effect and destroys it on the next event loop pass, which closes
// its audio stream. Not at once: it may be the sender of the signal being
// handled.
void release(QSoundEffect *&effect)
{
    if (QSoundEffect *stopped = std::exchange(effect, nullptr)) {
        stopped->stop();
        stopped->deleteLater();
    }
}
}

AlarmPlayer::AlarmPlayer(QObject *parent)
    : QObject(parent)
{
}

bool AlarmPlayer::isRinging() const
{
    return m_ringing;
}

void AlarmPlayer::setRinging(bool ringing)
{
    if (ringing == m_ringing) {
        return;
    }
    m_ringing = ringing;
    Q_EMIT ringingChanged();
    update();
}

QString AlarmPlayer::transition() const
{
    return m_transition;
}

void AlarmPlayer::setTransition(const QString &transition)
{
    if (transition == m_transition) {
        return;
    }
    m_transition = transition;
    Q_EMIT transitionChanged();
    update();
}

QVariantMap AlarmPlayer::sounds() const
{
    return m_sounds;
}

void AlarmPlayer::setSounds(const QVariantMap &sounds)
{
    if (sounds == m_sounds) {
        return;
    }
    m_sounds = sounds;
    Q_EMIT soundsChanged();
    update();
}

QString AlarmPlayer::soundsDirectory() const
{
    return m_directory;
}

void AlarmPlayer::setSoundsDirectory(const QString &directory)
{
    if (directory == m_directory) {
        return;
    }
    m_directory = directory;
    Q_EMIT soundsDirectoryChanged();
    update();
}

QUrl AlarmPlayer::source() const
{
    return m_source;
}

bool AlarmPlayer::isPlaying() const
{
    return m_playing;
}

bool AlarmPlayer::loops() const
{
    return m_alarm && m_alarm->loopCount() == QSoundEffect::Infinite;
}

QUrl AlarmPlayer::previewSource() const
{
    return m_previewSource;
}

bool AlarmPlayer::isPreviewing() const
{
    return m_preview && m_preview->isPlaying();
}

void AlarmPlayer::preview(const QString &soundId)
{
    const QUrl url = locate(soundId);
    if (url.isEmpty()) {
        return;
    }
    release(m_preview);
    m_previewSource = url;
    m_preview = new QSoundEffect(this);
    connect(m_preview, &QSoundEffect::playingChanged, this, [this, preview = m_preview] {
        if (preview != m_preview) {
            return;
        }
        if (!preview->isPlaying()) {
            release(m_preview);
        }
        Q_EMIT previewChanged();
    });
    m_preview->setSource(url);
    m_preview->play();
    Q_EMIT previewChanged();
}

void AlarmPlayer::stopPreview()
{
    if (!m_preview) {
        return;
    }
    release(m_preview);
    Q_EMIT previewChanged();
}

void AlarmPlayer::update()
{
    const QUrl url = m_ringing ? locate(chosenSound()) : QUrl();
    if (url.isEmpty()) {
        release(m_alarm);
        setSource(QUrl());
        setPlaying(false);
        return;
    }
    if (url == m_source && m_playing) {
        return;
    }
    release(m_alarm);
    m_alarm = new QSoundEffect(this);
    m_alarm->setLoopCount(QSoundEffect::Infinite);
    connect(m_alarm, &QSoundEffect::statusChanged, this, [this, alarm = m_alarm] {
        if (alarm == m_alarm && alarm->status() == QSoundEffect::Error) {
            qWarning("Tokkl: the alarm sound %s cannot play", qPrintable(alarm->source().toString()));
            setPlaying(false);
        }
    });
    m_alarm->setSource(url);
    m_alarm->play();
    setSource(url);
    setPlaying(true);
}

QString AlarmPlayer::chosenSound() const
{
    const std::optional<TransitionKind> kind = parseTransitionKind(m_transition);
    if (!kind) {
        return QString();
    }
    const QString chosen = m_sounds.value(m_transition).toString();
    return isSoundId(chosen) ? chosen : defaultSound(*kind);
}

QUrl AlarmPlayer::locate(const QString &soundId) const
{
    const std::optional<PomodoroSound> sound = pomodoroSound(soundId);
    if (!sound) {
        return QUrl();
    }
    QString path;
    if (m_directory.isEmpty()) {
        path = QStandardPaths::locate(QStandardPaths::GenericDataLocation,
                                      QStringLiteral("plasma/plasmoids/") + QStringLiteral(TOKKL_PLASMOID_ID) + QStringLiteral("/contents/sounds/") + sound->fileName);
    } else {
        path = m_directory + QLatin1Char('/') + sound->fileName;
    }
    if (path.isEmpty() || !QFileInfo::exists(path)) {
        return QUrl();
    }
    return QUrl::fromLocalFile(path);
}

void AlarmPlayer::setSource(const QUrl &url)
{
    if (url == m_source) {
        return;
    }
    m_source = url;
    Q_EMIT sourceChanged();
}

void AlarmPlayer::setPlaying(bool playing)
{
    if (playing == m_playing) {
        return;
    }
    m_playing = playing;
    Q_EMIT playingChanged();
}

}
