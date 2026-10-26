// The Pomodoro wiring the widget creates from QML: it builds the session
// and the preferences client once it has the connection, the timer and the
// store, and not before the QML document is complete, so a store whose
// applet binding evaluates after the wiring's own bindings is still read.
// Everything runs on the fakes of desktop/core and a QSettings store.

#include "fakes.h"
#include "kdepomodoro.h"
#include "pomodorostore.h"

#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

class KdePomodoroTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        SettingsPomodoroStore store{&settings};
        FakeTransport transport;
        FakeCredentialStore credentials;
        FakeClock clock;
        Connection connection{&transport, &credentials, testClientName()};
        TimerController timer{&clock};
    };

private Q_SLOTS:
    void buildsTheSessionOnceEverythingIsSet()
    {
        Fixture f;
        KdePomodoro pomodoro;
        QSignalSpy ready(&pomodoro, &KdePomodoro::sessionChanged);
        QCOMPARE(pomodoro.session(), nullptr);
        QCOMPARE(pomodoro.preferences(), nullptr);

        pomodoro.setConnection(&f.connection);
        pomodoro.setTimer(&f.timer);
        QCOMPARE(pomodoro.session(), nullptr);
        pomodoro.setStore(&f.store);
        QVERIFY(pomodoro.session());
        QVERIFY(pomodoro.preferences());
        QCOMPARE(ready.size(), 1);
        QCOMPARE(pomodoro.session()->parent(), &pomodoro);
        QCOMPARE(pomodoro.preferences()->parent(), &pomodoro);
    }

    void readsTheStoredModeThroughTheStore()
    {
        Fixture f;
        QVERIFY(f.store.savePomodoroMode(true));
        KdePomodoro pomodoro;
        pomodoro.setConnection(&f.connection);
        pomodoro.setTimer(&f.timer);
        pomodoro.setStore(&f.store);
        QVERIFY(pomodoro.session()->pomodoroMode());

        // The session writes the mode back through the same store.
        QVERIFY(pomodoro.session()->setPomodoroMode(false));
        QVERIFY(!f.store.loadPomodoroMode());
    }

    void waitsForTheDocumentToComplete()
    {
        Fixture f;
        KdePomodoro pomodoro;
        pomodoro.classBegin();
        pomodoro.setConnection(&f.connection);
        pomodoro.setTimer(&f.timer);
        pomodoro.setStore(&f.store);
        QCOMPARE(pomodoro.session(), nullptr);

        // The store's own bindings, such as its applet, land before
        // completion; the mode saved here stands for them.
        QVERIFY(f.store.savePomodoroMode(true));
        pomodoro.componentComplete();
        QVERIFY(pomodoro.session());
        QVERIFY(pomodoro.session()->pomodoroMode());
    }

    void aLateStoreStillBuildsTheSession()
    {
        Fixture f;
        KdePomodoro pomodoro;
        pomodoro.classBegin();
        pomodoro.setConnection(&f.connection);
        pomodoro.setTimer(&f.timer);
        pomodoro.componentComplete();
        QCOMPARE(pomodoro.session(), nullptr);
        pomodoro.setStore(&f.store);
        QVERIFY(pomodoro.session());
    }
};

QTEST_MAIN(KdePomodoroTest)

#include "kdepomodorotest.moc"
