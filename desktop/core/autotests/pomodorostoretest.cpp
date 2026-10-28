// The Pomodoro store on a QSettings file.

#include "pomodorostore.h"

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
            // What a save reported as stored is on disk.
            QSettings reopened(path, QSettings::IniFormat);
            SettingsPomodoroStore store(&reopened);
            QVERIFY(store.loadPomodoroMode());
            QVERIFY(store.savePomodoroMode(false));
            QVERIFY(!store.loadPomodoroMode());
        }

        // A file that cannot be written fails the save.
        QFile blocker(dir.filePath(QStringLiteral("blocker")));
        QVERIFY(blocker.open(QIODevice::WriteOnly));
        blocker.close();
        QSettings unwritable(dir.filePath(QStringLiteral("blocker/pomodoro.ini")), QSettings::IniFormat);
        SettingsPomodoroStore failing(&unwritable);
        QVERIFY(!failing.savePomodoroMode(true));
    }
};

QTEST_GUILESS_MAIN(PomodoroStoreTest)
#include "pomodorostoretest.moc"
