// The Pomodoro sounds the companions install, the files
// TOKKL_POMODORO_SOUND_FILES names, against the SHA-256 sums in
// docs/sounds/README.md, and the sound catalogue against those files.

#include "pomodorocycle.h"
#include "pomodorosounds.h"

#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QRegularExpression>
#include <QSet>
#include <QTest>

using namespace Tokkl;

namespace
{
// The build joins the list with "|", as a compile definition cannot hold
// CMake's ";".
QStringList soundFiles()
{
    return QStringLiteral(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|'), Qt::SkipEmptyParts);
}

// The sum the README gives each file name. Each sound's section names its
// file, as packages/web/public/sounds/<file>, and then gives the committed
// file's "SHA-256 `<hex>`", so a sum belongs to the file named last before
// it. Only the name counts, so the sums also hold for copies elsewhere.
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

    // Each file is a WAV with the sum the README gives its name.
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

    // The files are the catalogue's, in its order, so a platform can find
    // an installed sound by the catalogue's file name.
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

    // Every transition starts with a sound of its own from the catalogue,
    // and a stored id the catalogue no longer has is not taken for one.
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

private:
    // The README's sum for each file name.
    QHash<QString, QByteArray> m_sums;
};

QTEST_GUILESS_MAIN(PomodoroSoundsTest)

#include "pomodorosoundstest.moc"
