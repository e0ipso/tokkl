// The alarm player's choice of file and its start and stop, offscreen. It
// never asserts audio output: a container has no audio device, and whether
// a sound effect reaches the speakers is checked by hand with pactl.

#include "alarmplayer.h"
#include "pomodorosounds.h"

#include <QDir>
#include <QFile>
#include <QScopeGuard>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTest>
#include <QUrl>

using namespace Tokkl;

namespace
{
// The bundled sounds, from the core's sounds/ directory.
QString bundledSoundsDir()
{
    const QStringList files = QString::fromUtf8(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|'));
    return QFileInfo(files.first()).absolutePath();
}

QUrl bundled(const QString &soundId)
{
    return QUrl::fromLocalFile(bundledSoundsDir() + QStringLiteral("/pomodoro-") + soundId + QStringLiteral(".wav"));
}
}

class AlarmPlayerTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void playsTheTransitionsSoundWhileRinging_data()
    {
        QTest::addColumn<QString>("transition");
        QTest::addColumn<QVariantMap>("sounds");
        QTest::addColumn<QString>("expected");
        QTest::newRow("default per transition") << "workToShortRest" << QVariantMap() << "work-to-short-rest";
        QTest::newRow("long rest default") << "workToLongRest" << QVariantMap() << "work-to-long-rest";
        QTest::newRow("chosen sound") << "shortRestToWork"
                                      << QVariantMap{{QStringLiteral("shortRestToWork"), QStringLiteral("long-rest-to-work")}}
                                      << "long-rest-to-work";
        QTest::newRow("another transition's choice does not apply") << "longRestToWork"
                                                                    << QVariantMap{{QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}}
                                                                    << "long-rest-to-work";
        QTest::newRow("unknown choice falls back") << "workToShortRest"
                                                   << QVariantMap{{QStringLiteral("workToShortRest"), QStringLiteral("gong")}}
                                                   << "work-to-short-rest";
    }

    void playsTheTransitionsSoundWhileRinging()
    {
        QFETCH(QString, transition);
        QFETCH(QVariantMap, sounds);
        QFETCH(QString, expected);

        AlarmPlayer player;
        player.setSoundsDirectory(bundledSoundsDir());
        player.setSounds(sounds);
        player.setTransition(transition);
        QVERIFY(!player.isPlaying());
        QVERIFY(player.source().isEmpty());

        QSignalSpy playing(&player, &AlarmPlayer::playingChanged);
        player.setRinging(true);
        QCOMPARE(player.source(), bundled(expected));
        QVERIFY(player.isPlaying());
        QVERIFY(player.loops());
        QCOMPARE(playing.size(), 1);

        // The same ring again changes nothing.
        player.setRinging(true);
        QCOMPARE(playing.size(), 1);

        player.setRinging(false);
        QVERIFY(!player.isPlaying());
        QVERIFY(player.source().isEmpty());
        QCOMPARE(playing.size(), 2);
    }

    void aChangedChoiceAppliesToTheNextRing()
    {
        AlarmPlayer player;
        player.setSoundsDirectory(bundledSoundsDir());
        player.setTransition(QStringLiteral("workToShortRest"));
        player.setRinging(true);
        QCOMPARE(player.source(), bundled(QStringLiteral("work-to-short-rest")));

        // The user picks another sound while it rings: the ring follows.
        player.setSounds({{QStringLiteral("workToShortRest"), QStringLiteral("short-rest-to-work")}});
        QCOMPARE(player.source(), bundled(QStringLiteral("short-rest-to-work")));
        QVERIFY(player.isPlaying());
    }

    void withoutATransitionNothingPlays()
    {
        AlarmPlayer player;
        player.setSoundsDirectory(bundledSoundsDir());
        player.setRinging(true);
        QVERIFY(!player.isPlaying());
        QVERIFY(player.source().isEmpty());

        player.setTransition(QStringLiteral("lunch"));
        QVERIFY(!player.isPlaying());

        // The transition arrives after the ring started.
        player.setTransition(QStringLiteral("longRestToWork"));
        QVERIFY(player.isPlaying());
        QCOMPARE(player.source(), bundled(QStringLiteral("long-rest-to-work")));
    }

    void previewPlaysOnceAndReplacesTheEarlierOne()
    {
        AlarmPlayer player;
        player.setSoundsDirectory(bundledSoundsDir());

        player.preview(QStringLiteral("work-to-long-rest"));
        QCOMPARE(player.previewSource(), bundled(QStringLiteral("work-to-long-rest")));
        player.preview(QStringLiteral("short-rest-to-work"));
        QCOMPARE(player.previewSource(), bundled(QStringLiteral("short-rest-to-work")));

        // An unknown id is ignored, and the preview never touches the alarm.
        player.preview(QStringLiteral("gong"));
        QCOMPARE(player.previewSource(), bundled(QStringLiteral("short-rest-to-work")));
        QVERIFY(!player.isPlaying());
        QVERIFY(player.source().isEmpty());

        player.stopPreview();
        QVERIFY(!player.isPreviewing());
    }

    void findsTheSoundsOfTheInstalledWidget()
    {
        // XDG_DATA_HOME is the test's own; the widget's sounds go where the
        // package installs them.
        QTemporaryDir data;
        QVERIFY(data.isValid());
        const QByteArray earlier = qgetenv("XDG_DATA_HOME");
        auto restore = qScopeGuard([&earlier] {
            qputenv("XDG_DATA_HOME", earlier);
        });
        qputenv("XDG_DATA_HOME", data.path().toUtf8());
        const QString dir = data.path() + QStringLiteral("/plasma/plasmoids/") + QStringLiteral(TOKKL_PLASMOID_ID) + QStringLiteral("/contents/sounds");
        QVERIFY(QDir().mkpath(dir));
        for (const PomodoroSound &sound : pomodoroSounds()) {
            QVERIFY(QFile::copy(bundledSoundsDir() + QLatin1Char('/') + sound.fileName, dir + QLatin1Char('/') + sound.fileName));
        }

        AlarmPlayer player;
        QVERIFY(player.soundsDirectory().isEmpty());
        player.setTransition(QStringLiteral("workToShortRest"));
        player.setRinging(true);
        QCOMPARE(player.source(), QUrl::fromLocalFile(dir + QStringLiteral("/pomodoro-work-to-short-rest.wav")));
        QVERIFY(player.isPlaying());
    }

    void aMissingFileDoesNotPlay()
    {
        QTemporaryDir empty;
        QVERIFY(empty.isValid());
        AlarmPlayer player;
        player.setSoundsDirectory(empty.path());
        player.setTransition(QStringLiteral("workToShortRest"));
        player.setRinging(true);
        QVERIFY(!player.isPlaying());
        QVERIFY(player.source().isEmpty());
        player.preview(QStringLiteral("work-to-short-rest"));
        QVERIFY(player.previewSource().isEmpty());
    }
};

QTEST_MAIN(AlarmPlayerTest)

#include "alarmplayertest.moc"
