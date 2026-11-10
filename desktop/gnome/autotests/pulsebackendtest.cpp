// Playback itself is checked by hand with pactl.

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
        backend.playOnce(bundledSound());
        QVERIFY(errors.wait(10000));
        QCOMPARE(errors.size(), 2);
        // Also covers destruction while a stream is still connecting.
        backend.loop(bundledSound());
        backend.stop();
        backend.loop(bundledSound());
    }
};

QTEST_GUILESS_MAIN(PulseBackendTest)
#include "pulsebackendtest.moc"
