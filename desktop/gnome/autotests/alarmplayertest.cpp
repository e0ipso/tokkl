// The alarm player's file lookup and the WAV reader the sound server
// backend feeds from, against the bundled sounds. Nothing here reaches an
// audio server; what the player asks of the backend is checked in
// timerservicetest, and whether sound comes out is checked by hand with
// pactl.

#include "alarmplayer.h"
#include "pomodorosounds.h"
#include "wavfile.h"

#include <QByteArray>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QTest>
#include <QtEndian>

#include <optional>

using namespace Tokkl;

namespace
{
// The bundled sounds, from the core's sounds/ directory.
QStringList bundledSounds()
{
    return QString::fromUtf8(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|'));
}

QString bundledSoundsDir()
{
    return QFileInfo(bundledSounds().first()).absolutePath();
}

// A 44-byte RIFF WAVE header for the given format tag, followed by the
// samples.
QByteArray wavBytes(quint16 formatTag, quint16 channels, quint32 rate, quint16 bits, const QByteArray &samples)
{
    QByteArray bytes;
    auto u16 = [&bytes](quint16 value) {
        bytes.append(reinterpret_cast<const char *>(&value), 2);
    };
    auto u32 = [&bytes](quint32 value) {
        value = qToLittleEndian(value);
        bytes.append(reinterpret_cast<const char *>(&value), 4);
    };
    bytes.append("RIFF");
    u32(36 + samples.size());
    bytes.append("WAVEfmt ");
    u32(16);
    u16(qToLittleEndian(formatTag));
    u16(qToLittleEndian(channels));
    u32(rate);
    u32(rate * channels * bits / 8);
    u16(qToLittleEndian(quint16(channels * bits / 8)));
    u16(qToLittleEndian(bits));
    bytes.append("data");
    u32(samples.size());
    bytes.append(samples);
    return bytes;
}

bool writeFile(const QString &path, const QByteArray &bytes)
{
    QFile file(path);
    return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
}
}

class AlarmPlayerTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    // Each bundled sound is 16-bit mono PCM at 22050 Hz with a plain
    // 44-byte header, so the samples are the rest of the file.
    void readsTheBundledSounds_data()
    {
        QTest::addColumn<QString>("file");
        const QStringList files = bundledSounds();
        for (const QString &file : files) {
            QTest::newRow(qPrintable(QFileInfo(file).fileName())) << file;
        }
    }

    void readsTheBundledSounds()
    {
        QFETCH(QString, file);
        QString error;
        const std::optional<WavData> wav = readWavFile(file, &error);
        QVERIFY2(wav.has_value(), qPrintable(error));
        QCOMPARE(wav->sampleRate, 22050u);
        QCOMPARE(wav->channels, 1);
        QCOMPARE(wav->bitsPerSample, 16);
        QCOMPARE(wav->samples.size(), QFileInfo(file).size() - 44);
        QCOMPARE(wav->samples.size() % 2, 0);
    }

    // A LIST chunk before the data, as editors write, is skipped; the
    // samples are what the data chunk holds.
    void skipsOtherChunks()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QByteArray samples("\x01\x00\x02\x00\x03\x00\x04\x00", 8);
        QByteArray bytes = wavBytes(1, 2, 8000, 16, samples);
        // Insert a LIST chunk of 5 bytes (padded to 6) between fmt and data.
        const QByteArray list = QByteArray("LIST") + QByteArray("\x05\x00\x00\x00", 4) + QByteArray("abcde") + QByteArray("\0", 1);
        bytes.insert(36, list);
        const QString path = dir.filePath(QStringLiteral("list.wav"));
        QVERIFY(writeFile(path, bytes));
        QString error;
        const std::optional<WavData> wav = readWavFile(path, &error);
        QVERIFY2(wav.has_value(), qPrintable(error));
        QCOMPARE(wav->channels, 2);
        QCOMPARE(wav->sampleRate, 8000u);
        QCOMPARE(wav->samples, samples);
    }

    void rejectsWhatItCannotPlay_data()
    {
        QTest::addColumn<QByteArray>("bytes");
        QTest::addColumn<QString>("reason");
        const QByteArray samples(8, '\0');
        QTest::newRow("not a RIFF file") << QByteArray("hello, this is text and not a sound\n") << QStringLiteral("not a WAV file");
        QTest::newRow("float samples") << wavBytes(3, 1, 22050, 32, samples) << QStringLiteral("format 3");
        QTest::newRow("no data chunk") << wavBytes(1, 1, 22050, 16, samples).left(36) << QStringLiteral("no samples");
        QTest::newRow("truncated data") << wavBytes(1, 1, 22050, 16, samples).left(46) << QStringLiteral("truncated");
        QTest::newRow("no channels") << wavBytes(1, 0, 22050, 16, samples) << QStringLiteral("channels");
        QTest::newRow("odd sample width") << wavBytes(1, 1, 22050, 12, samples) << QStringLiteral("12-bit");
    }

    void rejectsWhatItCannotPlay()
    {
        QFETCH(QByteArray, bytes);
        QFETCH(QString, reason);
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString path = dir.filePath(QStringLiteral("sound.wav"));
        QVERIFY(writeFile(path, bytes));
        QString error;
        QVERIFY(!readWavFile(path, &error).has_value());
        QVERIFY2(error.contains(reason), qPrintable(error + QStringLiteral(" does not mention ") + reason));
        QVERIFY(error.contains(path));
    }

    void reportsAMissingFile()
    {
        QString error;
        QVERIFY(!readWavFile(QStringLiteral("/nonexistent/sound.wav"), &error).has_value());
        QVERIFY(error.contains(QStringLiteral("/nonexistent/sound.wav")));
    }

    // The player names a sound's file in the sounds directory, but only for
    // a sound the catalogue has and a file that is there.
    void locatesSoundsInTheDirectory()
    {
        const QString dir = bundledSoundsDir();
        QCOMPARE(soundFile(dir, QStringLiteral("work-to-short-rest")), dir + QStringLiteral("/pomodoro-work-to-short-rest.wav"));
        QCOMPARE(soundFile(dir + QLatin1Char('/'), QStringLiteral("long-rest-to-work")), dir + QStringLiteral("/pomodoro-long-rest-to-work.wav"));
        QCOMPARE(soundFile(dir, QStringLiteral("gong")), QString());
        QCOMPARE(soundFile(dir, QString()), QString());
        QTemporaryDir empty;
        QVERIFY(empty.isValid());
        QCOMPARE(soundFile(empty.path(), QStringLiteral("work-to-short-rest")), QString());
    }
};

QTEST_GUILESS_MAIN(AlarmPlayerTest)
#include "alarmplayertest.moc"
