#include "pomodorostore.h"

#include <QDir>
#include <QFile>
#include <QSettings>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

class PomodoroStoreTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void keepsTheModeAcrossRestarts()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString path = dir.filePath(QStringLiteral("pomodoro.ini"));
        {
            QSettings settings(path, QSettings::IniFormat);
            SettingsPomodoroStore store(&settings);
            QVERIFY(!store.loadPomodoroMode());
            QVERIFY(store.savePomodoroMode(true));
        }
        {
            QSettings reopened(path, QSettings::IniFormat);
            SettingsPomodoroStore store(&reopened);
            QVERIFY(store.loadPomodoroMode());
            QVERIFY(store.savePomodoroMode(false));
            QVERIFY(!store.loadPomodoroMode());
        }

        QFile blocker(dir.filePath(QStringLiteral("blocker")));
        QVERIFY(blocker.open(QIODevice::WriteOnly));
        blocker.close();
        QSettings unwritable(dir.filePath(QStringLiteral("blocker/pomodoro.ini")), QSettings::IniFormat);
        SettingsPomodoroStore failing(&unwritable);
        QVERIFY(!failing.savePomodoroMode(true));
    }

    // QSettings keeps the first error it meets.
    void aSaveAfterAFailedOneIsStored()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString path = dir.filePath(QStringLiteral("pomodoro.ini"));
        QSettings settings(path, QSettings::IniFormat);
        SettingsPomodoroStore store(&settings);
        QVERIFY(QDir().mkpath(path));
        QVERIFY(!store.savePomodoroMode(true));
        QVERIFY(!store.loadPomodoroMode());

        QVERIFY(QDir(path).removeRecursively());
        QVERIFY(store.savePomodoroMode(true));
        QVERIFY(store.loadPomodoroMode());
        QFile file(path);
        QVERIFY(file.open(QIODevice::ReadOnly));
        QVERIFY(file.readAll().contains("pomodoroMode=true"));
        QVERIFY(store.savePomodoroMode(false));
        QVERIFY(!store.loadPomodoroMode());
    }
};

QTEST_GUILESS_MAIN(PomodoroStoreTest)
#include "pomodorostoretest.moc"
