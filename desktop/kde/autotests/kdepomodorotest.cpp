// The Pomodoro wiring the widget creates from QML: it builds the session
// and the preferences client once it has the timer and the store, and not
// before the QML document is complete, so a store whose applet binding
// evaluates after the wiring's own bindings is still read. The session acts
// through the state client the timer reads. Everything runs on the fakes of
// desktop/core and a QSettings store.

#include "fakes.h"
#include "kdepomodoro.h"
#include "pomodorostore.h"
#include "timerstateclient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://a.example.test");

QByteArray json(const QJsonObject &object)
{
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

QByteArray meBody()
{
    return QByteArrayLiteral(
        R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})");
}

// A session in its first work phase, started at start; the open pomodoro
// is entry 5.
QJsonObject pomodoroObject(const QDateTime &start)
{
    return QJsonObject{
        {QStringLiteral("work_minutes"), 25},
        {QStringLiteral("short_rest_minutes"), 5},
        {QStringLiteral("long_rest_minutes"), 15},
        {QStringLiteral("long_rest_every"), 4},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), QStringLiteral("work")},
             {QStringLiteral("start"), start.toUTC().toString(Qt::ISODate)},
             {QStringLiteral("completed"), 0},
             {QStringLiteral("planned_end"), start.addSecs(25 * 60).toUTC().toString(Qt::ISODate)},
         }},
        {QStringLiteral("upcoming_phase"), QStringLiteral("shortRest")},
        {QStringLiteral("transition"), QStringLiteral("workToShortRest")},
        {QStringLiteral("number"), 1},
        {QStringLiteral("entry_id"), 5},
        {QStringLiteral("pomodoro_start"), start.toUTC().toString(Qt::ISODate)},
    };
}

QByteArray sessionState(const QDateTime &now)
{
    const QDateTime start = now.addSecs(-60);
    QJsonObject entry{
        {QStringLiteral("id"), 5},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("project_id"), QJsonValue::Null},
        {QStringLiteral("billable"), false},
        {QStringLiteral("start"), start.toUTC().toString(Qt::ISODate)},
        {QStringLiteral("stop"), QJsonValue::Null},
        {QStringLiteral("duration"), -start.toSecsSinceEpoch()},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
    return json(QJsonObject{
        {QStringLiteral("revision"), 4},
        {QStringLiteral("server_time"), now.toUTC().toString(Qt::ISODateWithMs)},
        {QStringLiteral("running_entry"), entry},
        {QStringLiteral("pause"), QJsonValue::Null},
        {QStringLiteral("pomodoro"), pomodoroObject(start)},
        {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
    });
}
}

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
        TimerStateClient client{&connection, &clock};
        TimerController timer{&clock};

        Fixture()
        {
            timer.setStateClient(&client);
        }

        // Signs in and answers the state read with a session started by
        // another device.
        bool showSession()
        {
            credentials.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), QStringLiteral("tok-1"));
            connection.setInstanceUrl(instance);
            if (!QTest::qWaitFor([&] {
                    return !transport.requests.isEmpty();
                })) {
                return false;
            }
            transport.respond(0, FakeTransport::answer(200, meBody()));
            for (qsizetype i = 0; i < transport.requests.size(); ++i) {
                const HttpRequest &request = transport.requests.at(i);
                if (request.method == "GET" && request.url.path().endsWith(QLatin1String("/app/timer"))) {
                    transport.respond(i, FakeTransport::answer(200, sessionState(clock.now())));
                    return true;
                }
            }
            return false;
        }
    };

private Q_SLOTS:
    void buildsTheSessionOnceEverythingIsSet()
    {
        Fixture f;
        KdePomodoro pomodoro;
        QSignalSpy ready(&pomodoro, &KdePomodoro::sessionChanged);
        QCOMPARE(pomodoro.session(), nullptr);
        QCOMPARE(pomodoro.preferences(), nullptr);

        pomodoro.setTimer(&f.timer);
        QCOMPARE(pomodoro.session(), nullptr);
        pomodoro.setStore(&f.store);
        QVERIFY(pomodoro.session());
        QVERIFY(pomodoro.preferences());
        QCOMPARE(ready.size(), 1);
        QCOMPARE(pomodoro.session()->parent(), &pomodoro);
        QCOMPARE(pomodoro.preferences()->parent(), &pomodoro);
    }

    void theSessionActsThroughTheStateTheTimerReads()
    {
        Fixture f;
        KdePomodoro pomodoro;
        pomodoro.setTimer(&f.timer);
        pomodoro.setStore(&f.store);
        QVERIFY(!pomodoro.session()->isActive());
        QVERIFY(!f.timer.isSessionActive());

        // A session another device started shows in the session and the
        // timer alike, in Timer mode.
        QVERIFY(f.showSession());
        QVERIFY(!pomodoro.session()->pomodoroMode());
        QVERIFY(pomodoro.session()->isActive());
        QCOMPARE(pomodoro.session()->phase(), QStringLiteral("work"));
        QVERIFY(f.timer.isSessionActive());
        QVERIFY(pomodoro.session()->modeLocked());

        // Next phase sends the revision of that state through the client.
        QVERIFY(pomodoro.session()->confirmNextPhase());
        const HttpRequest &next = f.transport.requests.last();
        QVERIFY(next.url.path().endsWith(QLatin1String("/pomodoro/next")));
        QCOMPARE(next.body, QByteArrayLiteral("{\"revision\":4}"));
    }

    void readsTheStoredModeThroughTheStore()
    {
        Fixture f;
        QVERIFY(f.store.savePomodoroMode(true));
        KdePomodoro pomodoro;
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
        pomodoro.setTimer(&f.timer);
        pomodoro.componentComplete();
        QCOMPARE(pomodoro.session(), nullptr);
        pomodoro.setStore(&f.store);
        QVERIFY(pomodoro.session());
    }

    void aLateStateClientStillBuildsTheSession()
    {
        Fixture f;
        TimerController bare{&f.clock};
        KdePomodoro pomodoro;
        pomodoro.setTimer(&bare);
        pomodoro.setStore(&f.store);
        QCOMPARE(pomodoro.session(), nullptr);

        QSignalSpy built(&pomodoro, &KdePomodoro::sessionChanged);
        bare.setStateClient(&f.client);
        QVERIFY(pomodoro.session());
        QCOMPARE(built.size(), 1);

        // The timer loses the client: the session built on it goes too.
        bare.setStateClient(nullptr);
        QCOMPARE(pomodoro.session(), nullptr);
        QCOMPARE(pomodoro.preferences(), nullptr);
        QCOMPARE(built.size(), 2);
    }
};

QTEST_MAIN(KdePomodoroTest)

#include "kdepomodorotest.moc"
