#include "apitypes.h"
#include "pomodorosounds.h"
#include "soundchoices.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QRegularExpression>
#include <QSet>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

namespace
{
// The build joins the list with "|": a compile definition cannot hold CMake's ";".
QStringList soundFiles()
{
    return QStringLiteral(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|'), Qt::SkipEmptyParts);
}

// A sum belongs to the file the README names last before it. Only the name
// counts, so the sums also hold for copies elsewhere.
QHash<QString, QByteArray> readmeSums(const QString &text)
{
    static const QRegularExpression token(QStringLiteral("([A-Za-z0-9_.-]+\\.wav)|SHA-256 `([0-9a-f]{64})`"));
    QHash<QString, QByteArray> sums;
    QString file;
    for (const QRegularExpressionMatch &match : token.globalMatch(text)) {
        if (match.hasCaptured(1)) {
            file = match.captured(1);
        } else if (!file.isEmpty()) {
            sums.insert(file, match.captured(2).toLatin1());
            file.clear();
        }
    }
    return sums;
}
}

class PomodoroSoundsTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        QFile readme(QStringLiteral(TOKKL_SOUNDS_README));
        QVERIFY2(readme.open(QIODevice::ReadOnly), qPrintable(readme.fileName() + QStringLiteral(": ") + readme.errorString()));
        m_sums = readmeSums(QString::fromUtf8(readme.readAll()));
        QVERIFY2(!m_sums.isEmpty(), qPrintable(readme.fileName() + QStringLiteral(" gives no SHA-256 sum for a .wav file")));
    }

    void files_data()
    {
        QTest::addColumn<QString>("path");
        for (const QString &path : soundFiles()) {
            QTest::newRow(qPrintable(QFileInfo(path).fileName())) << path;
        }
    }

    void files()
    {
        QFETCH(QString, path);
        const QString name = QFileInfo(path).fileName();
        QVERIFY2(m_sums.contains(name), qPrintable(QStringLiteral(TOKKL_SOUNDS_README " gives no SHA-256 sum for ") + name));

        QFile file(path);
        QVERIFY2(file.open(QIODevice::ReadOnly), qPrintable(path + QStringLiteral(": ") + file.errorString()));
        const QByteArray bytes = file.readAll();
        QVERIFY2(bytes.size() >= 12 && bytes.startsWith("RIFF") && bytes.mid(8, 4) == "WAVE", qPrintable(path + QStringLiteral(" is not a RIFF WAVE file")));
        QCOMPARE(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex(), m_sums.value(name));
    }

    // A platform finds an installed sound by the catalogue's file name.
    void catalogueNamesTheFiles()
    {
        QStringList names;
        for (const QString &path : soundFiles()) {
            names.append(QFileInfo(path).fileName());
        }
        QStringList catalogue;
        for (const PomodoroSound &sound : pomodoroSounds()) {
            catalogue.append(sound.fileName);
        }
        QCOMPARE(names, catalogue);
    }

    void defaults()
    {
        QSet<QString> ids;
        for (const TransitionKind kind :
             {TransitionKind::WorkToShortRest, TransitionKind::ShortRestToWork, TransitionKind::WorkToLongRest, TransitionKind::LongRestToWork}) {
            const QString id = defaultSound(kind);
            QVERIFY2(isSoundId(id), qPrintable(transitionKindName(kind) + QStringLiteral(" defaults to ") + id));
            QCOMPARE(pomodoroSound(id)->id, id);
            ids.insert(id);
        }
        QCOMPARE(ids.size(), 4);
        QVERIFY(!isSoundId(QString()));
        QVERIFY(!pomodoroSound(QStringLiteral("pomodoro-work-to-short-rest")));
    }

    void chosenFallsBackToTheDefault()
    {
        QCOMPARE(chosenSound(u"long-rest-to-work", TransitionKind::WorkToShortRest), QStringLiteral("long-rest-to-work"));
        QCOMPARE(chosenSound(u"gong", TransitionKind::WorkToShortRest), defaultSound(TransitionKind::WorkToShortRest));
        QCOMPARE(chosenSound(QStringView(), TransitionKind::LongRestToWork), defaultSound(TransitionKind::LongRestToWork));
    }

    void locatesFiles()
    {
        const QString dir = QFileInfo(soundFiles().first()).absolutePath();
        QCOMPARE(soundFile(dir, u"work-to-short-rest"), dir + QStringLiteral("/pomodoro-work-to-short-rest.wav"));
        QCOMPARE(soundFile(dir + QLatin1Char('/'), u"long-rest-to-work"), dir + QStringLiteral("/pomodoro-long-rest-to-work.wav"));
        QCOMPARE(soundFile(dir, u"gong"), QString());
        QTemporaryDir empty;
        QVERIFY(empty.isValid());
        QCOMPARE(soundFile(empty.path(), u"work-to-short-rest"), QString());
    }

    void choicesUseTheGivenKeys()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString file = dir.filePath(QStringLiteral("choices.conf"));
        const auto key = [](TransitionKind kind) {
            return QStringLiteral("Sounds/") + transitionKindName(kind);
        };
        {
            QSettings settings(file, QSettings::IniFormat);
            SoundChoices choices(&settings, key);
            QSignalSpy changed(&choices, &SoundChoices::changed);
            QCOMPARE(choices.chosen(TransitionKind::WorkToShortRest), defaultSound(TransitionKind::WorkToShortRest));
            QVERIFY(choices.choose(TransitionKind::WorkToShortRest, QStringLiteral("long-rest-to-work")));
            QCOMPARE(changed.size(), 1);
            QVERIFY(choices.choose(TransitionKind::WorkToShortRest, QStringLiteral("long-rest-to-work")));
            QCOMPARE(changed.size(), 1);
            QVERIFY(!choices.choose(TransitionKind::WorkToShortRest, QStringLiteral("gong")));
            QCOMPARE(choices.chosen(TransitionKind::WorkToShortRest), QStringLiteral("long-rest-to-work"));
        }
        QSettings reread(file, QSettings::IniFormat);
        QCOMPARE(reread.value(QStringLiteral("Sounds/workToShortRest")).toString(), QStringLiteral("long-rest-to-work"));
        SoundChoices none(nullptr, key);
        QVERIFY(!none.choose(TransitionKind::WorkToShortRest, QStringLiteral("long-rest-to-work")));
        QCOMPARE(none.chosen(TransitionKind::WorkToShortRest), defaultSound(TransitionKind::WorkToShortRest));
    }

    // QSettings keeps the first error it meets.
    void aChoiceAfterAFailedOneIsStored()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString file = dir.filePath(QStringLiteral("choices.conf"));
        QSettings settings(file, QSettings::IniFormat);
        SoundChoices choices(&settings, [](TransitionKind kind) {
            return QStringLiteral("Sounds/") + transitionKindName(kind);
        });
        QSignalSpy changed(&choices, &SoundChoices::changed);
        QVERIFY(QDir().mkpath(file));
        QVERIFY(!choices.choose(TransitionKind::WorkToShortRest, QStringLiteral("long-rest-to-work")));
        QCOMPARE(choices.chosen(TransitionKind::WorkToShortRest), defaultSound(TransitionKind::WorkToShortRest));
        QCOMPARE(changed.size(), 0);

        QVERIFY(QDir(file).removeRecursively());
        QVERIFY(choices.choose(TransitionKind::WorkToShortRest, QStringLiteral("long-rest-to-work")));
        QCOMPARE(changed.size(), 1);
        QCOMPARE(choices.chosen(TransitionKind::WorkToShortRest), QStringLiteral("long-rest-to-work"));
        QFile written(file);
        QVERIFY(written.open(QIODevice::ReadOnly));
        QVERIFY(written.readAll().contains("workToShortRest=long-rest-to-work"));
    }

private:
    QHash<QString, QByteArray> m_sums;
};

QTEST_GUILESS_MAIN(PomodoroSoundsTest)

#include "pomodorosoundstest.moc"
