#include "alarmplayer.h"

#include "apitypes.h"
#include "logging.h"
#include "pomodorosounds.h"

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

QString AlarmPlayer::error() const
{
    return m_error;
}

void AlarmPlayer::preview(const QString &soundId)
{
    const QUrl url = locate(soundId);
    if (url.isEmpty()) {
        if (pomodoroSound(soundId)) {
            setError(missingError(soundId));
        }
        return;
    }
    setError(QString());
    release(m_preview);
    m_previewSource = url;
    m_preview = new QSoundEffect(this);
    connect(m_preview, &QSoundEffect::statusChanged, this, [this, preview = m_preview] {
        if (preview == m_preview && preview->status() == QSoundEffect::Error) {
            qCWarning(lcAlarm) << "The preview sound cannot play:" << preview->source().toString();
            setError(effectError(preview->source()));
        }
    });
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
    const QString soundId = m_ringing ? chosenSound() : QString();
    const QUrl url = soundId.isEmpty() ? QUrl() : locate(soundId);
    if (url.isEmpty()) {
        if (!soundId.isEmpty()) {
            setError(missingError(soundId));
        }
        release(m_alarm);
        setSource(QUrl());
        setPlaying(false);
        return;
    }
    if (url == m_source && m_playing) {
        return;
    }
    release(m_alarm);
    setError(QString());
    m_alarm = new QSoundEffect(this);
    m_alarm->setLoopCount(QSoundEffect::Infinite);
    connect(m_alarm, &QSoundEffect::statusChanged, this, [this, alarm = m_alarm] {
        if (alarm == m_alarm && alarm->status() == QSoundEffect::Error) {
            qCWarning(lcAlarm) << "The alarm sound cannot play:" << alarm->source().toString();
            setError(effectError(alarm->source()));
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
    return Tokkl::chosenSound(m_sounds.value(m_transition).toString(), *kind);
}

QUrl AlarmPlayer::locate(const QString &soundId) const
{
    QString path;
    if (!m_directory.isEmpty()) {
        path = soundFile(m_directory, soundId);
    } else if (const std::optional<PomodoroSound> sound = pomodoroSound(soundId)) {
        path = QStandardPaths::locate(QStandardPaths::GenericDataLocation,
                                      QStringLiteral("plasma/plasmoids/") + QStringLiteral(TOKKL_PLASMOID_ID) + QStringLiteral("/contents/sounds/") + sound->fileName);
    }
    return path.isEmpty() ? QUrl() : QUrl::fromLocalFile(path);
}

void AlarmPlayer::setSource(const QUrl &url)
{
    if (url == m_source) {
        return;
    }
    m_source = url;
    Q_EMIT sourceChanged();
}

void AlarmPlayer::setError(const QString &error)
{
    if (error == m_error) {
        return;
    }
    m_error = error;
    Q_EMIT errorChanged();
}

QString AlarmPlayer::missingError(const QString &soundId)
{
    return tr("No alarm sound: the file for %1 is not installed").arg(soundId);
}

QString AlarmPlayer::effectError(const QUrl &url)
{
    return tr("No alarm sound: %1 cannot be played").arg(url.toLocalFile());
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
