// The sound server backend with no server to reach: it reports what it
// could not play and its stream threads end, so the service goes on
// without audio. Playback itself is checked by hand with pactl.

#include "pulsealarmbackend.h"

#include <QFileInfo>
#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
QString bundledSound()
{
    return QString::fromUtf8(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|')).first();
}
}

class PulseBackendTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        // No server, and no attempt to spawn one.
        qputenv("PULSE_SERVER", "unix:/nonexistent/pulse");
        QVERIFY(QFileInfo::exists(bundledSound()));
    }

    void reportsAFileItCannotRead()
    {
        PulseAlarmBackend backend(QStringLiteral("test"));
        QSignalSpy errors(&backend, &PulseAlarmBackend::errorOccurred);
        backend.loop(QStringLiteral("/nonexistent/sound.wav"));
        QCOMPARE(errors.size(), 1);
        QVERIFY(errors.first().first().toString().contains(QStringLiteral("/nonexistent/sound.wav")));
        backend.playOnce(QStringLiteral("/nonexistent/sound.wav"));
        QCOMPARE(errors.size(), 2);
    }

    void reportsARefusedConnection()
    {
        PulseAlarmBackend backend(QStringLiteral("test"));
        QSignalSpy errors(&backend, &PulseAlarmBackend::errorOccurred);
        backend.loop(bundledSound());
        QVERIFY(errors.wait(10000));
        QCOMPARE(errors.size(), 1);
        QVERIFY2(errors.first().first().toString().contains(QStringLiteral("Connection refused")), qPrintable(errors.first().first().toString()));
        QVERIFY(errors.first().first().toString().contains(QFileInfo(bundledSound()).fileName()));
        backend.stop();
        // Another start after the refusal tries again rather than staying
        // silent for good.
        backend.playOnce(bundledSound());
        QVERIFY(errors.wait(10000));
        QCOMPARE(errors.size(), 2);
        // A loop stopped before the server answers ends cleanly, as does
        // the backend's destruction while a stream is still trying.
        backend.loop(bundledSound());
        backend.stop();
        backend.loop(bundledSound());
    }
};

QTEST_GUILESS_MAIN(PulseBackendTest)
#include "pulsebackendtest.moc"
