#pragma once

// The Pomodoro alarm as the widget plays it: the chosen sound loops while
// the session rings, and the settings page previews a sound once.
//
// It lives in tokklkde rather than in the backend QML module so the
// autotests can drive it without a QML engine, and so the core, which the
// tests also link, stays free of Qt Multimedia: only tokklkde links it.

#include <QObject>
#include <QSoundEffect>
#include <QString>
#include <QUrl>
#include <QVariantMap>

namespace Tokkl
{

// Follows the session's ringing and ringingTransition. While ringing is true
// the sound chosen for the transition loops without end; it stops the moment
// ringing turns false. The choice comes from sounds, a map from transition
// name ("workToShortRest" and so on) to sound id, and falls back to the
// catalogue's default for the transition when the map has no valid id for
// it. A transition the catalogue does not know plays nothing.
//
// The files are the four WAVs installed with the widget. soundsDirectory
// names where they are; empty, the default, looks for the installed widget
// package in the data directories. A file that is not there plays nothing.
//
// playing is the player's own state: true from the start of a ring until
// ringing turns false, or until the sound effect reports an error, which Qt
// Multimedia does for a file it cannot read and for a machine without an
// audio output device. previewing follows the preview sound effect itself.
//
// Each ring and each preview gets a sound effect of its own, destroyed once
// it stops. A stopped effect keeps its audio stream open, paused, for as long
// as it exists, and the sound server would go on listing the widget as a
// paused audio application.
class AlarmPlayer : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool ringing READ isRinging WRITE setRinging NOTIFY ringingChanged)
    Q_PROPERTY(QString transition READ transition WRITE setTransition NOTIFY transitionChanged)
    Q_PROPERTY(QVariantMap sounds READ sounds WRITE setSounds NOTIFY soundsChanged)
    Q_PROPERTY(QString soundsDirectory READ soundsDirectory WRITE setSoundsDirectory NOTIFY soundsDirectoryChanged)
    // The file that loops; empty while nothing rings.
    Q_PROPERTY(QUrl source READ source NOTIFY sourceChanged)
    Q_PROPERTY(bool playing READ isPlaying NOTIFY playingChanged)
    // The file preview() last played, until the next preview.
    Q_PROPERTY(QUrl previewSource READ previewSource NOTIFY previewChanged)
    Q_PROPERTY(bool previewing READ isPreviewing NOTIFY previewChanged)

public:
    explicit AlarmPlayer(QObject *parent = nullptr);

    bool isRinging() const;
    void setRinging(bool ringing);
    QString transition() const;
    void setTransition(const QString &transition);
    QVariantMap sounds() const;
    void setSounds(const QVariantMap &sounds);
    QString soundsDirectory() const;
    void setSoundsDirectory(const QString &directory);

    QUrl source() const;
    bool isPlaying() const;
    // Whether the ringing alarm loops without end; false while none rings.
    bool loops() const;
    QUrl previewSource() const;
    bool isPreviewing() const;

    // Plays the sound once, stopping an earlier preview. An id the catalogue
    // does not have, or a file that is missing, is ignored.
    Q_INVOKABLE void preview(const QString &soundId);
    Q_INVOKABLE void stopPreview();

Q_SIGNALS:
    void ringingChanged();
    void transitionChanged();
    void soundsChanged();
    void soundsDirectoryChanged();
    void sourceChanged();
    void playingChanged();
    void previewChanged();

private:
    // Starts, switches or stops the alarm to match the properties.
    void update();
    // The sound id to play for the transition, or empty.
    QString chosenSound() const;
    // The local file of a sound id, or an empty URL when it is not there.
    QUrl locate(const QString &soundId) const;
    void setSource(const QUrl &url);
    void setPlaying(bool playing);

    bool m_ringing = false;
    QString m_transition;
    QVariantMap m_sounds;
    QString m_directory;
    QUrl m_source;
    bool m_playing = false;
    QUrl m_previewSource;
    // Children of the player; null between rings and between previews.
    QSoundEffect *m_alarm = nullptr;
    QSoundEffect *m_preview = nullptr;
};

}
