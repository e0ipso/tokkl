#pragma once

// Lives in tokklkde, not the QML module, so autotests drive it without a
// QML engine and the core stays free of Qt Multimedia.

#include <QObject>
#include <QSoundEffect>
#include <QString>
#include <QUrl>
#include <QVariantMap>

namespace Tokkl
{

// Each ring and preview gets its own QSoundEffect, destroyed once it stops:
// a stopped effect keeps a paused stream the sound server lists.
class AlarmPlayer : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool ringing READ isRinging WRITE setRinging NOTIFY ringingChanged)
    Q_PROPERTY(QString transition READ transition WRITE setTransition NOTIFY transitionChanged)
    Q_PROPERTY(QVariantMap sounds READ sounds WRITE setSounds NOTIFY soundsChanged)
    Q_PROPERTY(QString soundsDirectory READ soundsDirectory WRITE setSoundsDirectory NOTIFY soundsDirectoryChanged)
    Q_PROPERTY(QUrl source READ source NOTIFY sourceChanged)
    Q_PROPERTY(bool playing READ isPlaying NOTIFY playingChanged)
    Q_PROPERTY(QUrl previewSource READ previewSource NOTIFY previewChanged)
    Q_PROPERTY(bool previewing READ isPreviewing NOTIFY previewChanged)
    Q_PROPERTY(QString error READ error NOTIFY errorChanged)

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
    bool loops() const;
    QUrl previewSource() const;
    bool isPreviewing() const;
    QString error() const;

    // Ignores an unknown id or a missing file.
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
    void errorChanged();

private:
    void update();
    QString chosenSound() const;
    QUrl locate(const QString &soundId) const;
    void setSource(const QUrl &url);
    void setPlaying(bool playing);
    void setError(const QString &error);
    static QString missingError(const QString &soundId);
    static QString effectError(const QUrl &url);

    bool m_ringing = false;
    QString m_transition;
    QVariantMap m_sounds;
    QString m_directory;
    QUrl m_source;
    bool m_playing = false;
    QUrl m_previewSource;
    QString m_error;
    // Null between rings and between previews.
    QSoundEffect *m_alarm = nullptr;
    QSoundEffect *m_preview = nullptr;
};

}
