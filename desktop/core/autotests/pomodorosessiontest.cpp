// The Pomodoro session next to the timer controller and its state client,
// driven through the fake clock and the scripted transport. Timer states come
// from read replies, action replies and the event stream, as they would from
// the server, so a state from the stream stands for another device.

#include "connection.h"
#include "fakes.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

#include <memory>
#include <optional>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-session-1");
const QByteArray statePath = "/app/timer";
const QByteArray startPath = "/app/pomodoro";
const QByteArray nextPath = "/app/pomodoro/next";
const QByteArray endPath = "/app/pomodoro/end";
const QByteArray entriesPath = "/workspaces/7/time_entries";
const QString tooShort = QStringLiteral("This pomodoro was too short to save.");

QByteArray meBody()
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), 3},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), QStringLiteral("UTC")},
                             {QStringLiteral("default_workspace_id"), 7},
                             {QStringLiteral("beginning_of_week"), 1},
                         })
        .toJson(QJsonDocument::Compact);
}

QString iso(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODateWithMs);
}

// A running entry of the workspace in the v9 shape.
QJsonObject runningEntry(qint64 id, const QDateTime &start)
{
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("project_id"), 11},
        {QStringLiteral("billable"), true},
        {QStringLiteral("start"), iso(start)},
        {QStringLiteral("stop"), QJsonValue::Null},
        {QStringLiteral("duration"), -start.toSecsSinceEpoch()},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
}

// One active, billable project of the workspace.
QByteArray projectsBody()
{
    return QByteArrayLiteral(R"([{"id":11,"workspace_id":7,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])");
}

// The phase of a session on the server's clock, with what the server derives
// from it. Lengths are one minute, with a long rest after every second work
// phase.
struct Phase {
    QString kind;
    QDateTime start;
    int completed = 0;
    QString upcoming;
    QString transition;
    int number = 1;
    QDateTime pomodoroStart; // the open pomodoro's start; the phase start when invalid
};

Phase work(const QDateTime &start, int completed = 0)
{
    return Phase{QStringLiteral("work"),
                 start,
                 completed,
                 completed + 1 >= 2 ? QStringLiteral("longRest") : QStringLiteral("shortRest"),
                 completed + 1 >= 2 ? QStringLiteral("workToLongRest") : QStringLiteral("workToShortRest"),
                 completed + 1,
                 start};
}

Phase shortRest(const QDateTime &start, const QDateTime &pomodoroStart)
{
    return Phase{QStringLiteral("shortRest"), start, 1, QStringLiteral("work"), QStringLiteral("shortRestToWork"), 1, pomodoroStart};
}

QJsonObject pomodoroJson(const Phase &phase, qint64 entryId)
{
    const QDateTime pomodoroStart = phase.pomodoroStart.isValid() ? phase.pomodoroStart : phase.start;
    return QJsonObject{
        {QStringLiteral("work_minutes"), 1},
        {QStringLiteral("short_rest_minutes"), 1},
        {QStringLiteral("long_rest_minutes"), 1},
        {QStringLiteral("long_rest_every"), 2},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), phase.kind},
             {QStringLiteral("start"), iso(phase.start)},
             {QStringLiteral("completed"), phase.completed},
             {QStringLiteral("planned_end"), iso(phase.start.addSecs(60))},
         }},
        {QStringLiteral("upcoming_phase"), phase.upcoming},
        {QStringLiteral("transition"), phase.transition},
        {QStringLiteral("number"), phase.number},
        {QStringLiteral("entry_id"), entryId},
        {QStringLiteral("pomodoro_start"), iso(pomodoroStart)},
    };
}
}

class PomodoroSessionTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        FakeTransport transport;
        FakeCredentialStore credentials;
        FakeClock clock;
        SettingsPomodoroStore store{&settings};
        Connection connection{&transport, &credentials, testClientName()};
        TimerStateClient client{&connection, &clock};
        TimerController timer{&clock};
        // Absent for a test that creates it later, as after a restart.
        std::unique_ptr<PomodoroSession> session;
        qint64 revision = 0; // of the last state built
        // The server's clock minus this device's.
        qint64 skewMs = 0;
        qint64 entryId = 41;

        explicit Fixture(bool withSession = true)
        {
            timer.setStateClient(&client);
            if (withSession) {
                createSession();
            }
        }

        void createSession()
        {
            session = std::make_unique<PomodoroSession>(&clock, &timer, &client, &store);
        }

        QDateTime serverNow() const
        {
            return clock.now().addMSecs(skewMs);
        }

        // Requests whose path ends with the given text.
        QList<qsizetype> find(const QByteArray &method, const QByteArray &suffix) const
        {
            QList<qsizetype> found;
            for (qsizetype i = 0; i < transport.requests.size(); ++i) {
                const HttpRequest &request = transport.requests.at(i);
                if (request.method == method && request.url.path().toUtf8().endsWith(suffix)) {
                    found.append(i);
                }
            }
            return found;
        }

        qsizetype last(const QByteArray &method, const QByteArray &suffix) const
        {
            const QList<qsizetype> found = find(method, suffix);
            return found.isEmpty() ? -1 : found.last();
        }

        QJsonObject body(qsizetype index) const
        {
            return QJsonDocument::fromJson(transport.requests.at(index).body).object();
        }

        // The state at the next revision, built now on the server's clock:
        // the session in phase, or none, and a pomodoro the change discarded.
        QByteArray state(const std::optional<Phase> &phase, const QJsonValue &discarded = QJsonValue::Null)
        {
            const QDateTime pomodoroStart = phase && phase->pomodoroStart.isValid() ? phase->pomodoroStart : phase ? phase->start : QDateTime();
            const QJsonObject body{
                {QStringLiteral("revision"), ++revision},
                {QStringLiteral("server_time"), iso(serverNow())},
                {QStringLiteral("running_entry"), phase ? QJsonValue(runningEntry(entryId, pomodoroStart)) : QJsonValue(QJsonValue::Null)},
                {QStringLiteral("pause"), QJsonValue::Null},
                {QStringLiteral("pomodoro"), phase ? QJsonValue(pomodoroJson(*phase, entryId)) : QJsonValue(QJsonValue::Null)},
                {QStringLiteral("discarded_pomodoro"), discarded},
            };
            return QJsonDocument(body).toJson(QJsonDocument::Compact);
        }

        // A state from the event stream, as another device's change sends it.
        void push(const QByteArray &state)
        {
            transport.lastStream()->push("event: timer\ndata: " + state + "\n\n");
        }

        void respond(qsizetype index, const QByteArray &state, int status = 200)
        {
            transport.respond(index, FakeTransport::answer(status, state));
        }

        void tick(int seconds)
        {
            for (int i = 0; i < seconds; ++i) {
                clock.advance(1000);
            }
        }
    };

    // Configure token auth, answer /me, then the state read with the given
    // state (nothing running by default) and the project list.
    static bool connectAccount(Fixture &f, const QByteArray &state = QByteArray(), const QString &instance = instanceA)
    {
        f.credentials.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(instance);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.transport.respond(before, FakeTransport::answer(200, meBody()));
        const qsizetype read = f.last("GET", statePath);
        const qsizetype projects = f.last("GET", "/projects");
        if (read < 0 || projects < 0 || !f.transport.lastStream()) {
            return false;
        }
        f.respond(read, state.isEmpty() ? f.state(std::nullopt) : state);
        f.respond(projects, projectsBody());
        return f.timer.isConnected() && f.client.state().has_value();
    }

private Q_SLOTS:
    void followsASessionStartedElsewhere()
    {
        Fixture f;
        // The server's clock runs 30 s ahead of this device's.
        f.skewMs = 30'000;
        QVERIFY(connectAccount(f));
        QVERIFY(!f.session->pomodoroMode());
        QVERIFY(!f.session->isActive());
        QVERIFY(!f.session->modeLocked());

        // Another device started a session 10 s ago. It shows in Timer mode,
        // on this device's clock, and locks the mode.
        QSignalSpy sessionChanges(f.session.get(), &PomodoroSession::sessionChanged);
        const QDateTime start = f.serverNow().addSecs(-10);
        f.push(f.state(work(start)));
        QCOMPARE(sessionChanges.size(), 1);
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->modeLocked());
        QVERIFY(f.timer.isSessionActive());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.session->setPomodoroMode(true));
        QVERIFY(!f.session->pomodoroMode());
        QVERIFY(!f.session->canStartSession());
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.session->phaseStart(), f.clock.now().addSecs(-10));
        QCOMPARE(f.session->plannedEnd(), f.clock.now().addSecs(50));
        QCOMPARE(f.session->remainingSeconds(), 50);
        QCOMPARE(f.session->countdownText(), QStringLiteral("0:50"));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        QCOMPARE(f.session->longRestEvery(), 2);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("shortRest"));
        QVERIFY(!f.session->isRinging());

        // Before the planned end a click opens the menu.
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::OpenMenu);
        QVERIFY(f.find("POST", nextPath).isEmpty());

        // It rings at the server's planned end, not 30 s later on this
        // device's clock.
        QSignalSpy ringing(f.session.get(), &PomodoroSession::ringingChanged);
        f.tick(49);
        QCOMPARE(f.session->countdownText(), QStringLiteral("0:01"));
        QCOMPARE(ringing.size(), 0);
        f.tick(1);
        QVERIFY(f.session->isRinging());
        QCOMPARE(ringing.size(), 1);
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("workToShortRest"));
        QCOMPARE(f.session->countdownText(), QStringLiteral("+0:00"));
        f.tick(2);
        QCOMPARE(f.session->overtimeSeconds(), 2);
        QCOMPARE(f.session->countdownText(), QStringLiteral("+0:02"));

        // A state of the same phase, such as an edit of the running entry,
        // and a clock set back keep it ringing.
        f.push(f.state(work(start)));
        f.clock.advance(-5000);
        QVERIFY(f.session->isRinging());
        QCOMPARE(ringing.size(), 1);
        f.clock.advance(5000);

        // A click confirms Next phase against the revision shown, once.
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype next = f.last("POST", nextPath);
        QVERIFY(next >= 0);
        QCOMPARE(f.body(next), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Ignored);
        QCOMPARE(f.find("POST", nextPath).size(), 1);
        QVERIFY(f.session->isRinging());

        // The new phase stops the alarm.
        const QDateTime rest = f.serverNow();
        f.respond(next, f.state(shortRest(rest, start)));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(ringing.size(), 2);
        QCOMPARE(f.session->ringingTransition(), QString());
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        QCOMPARE(f.session->phaseStart(), f.clock.now());
        QCOMPARE(f.session->countdownText(), QStringLiteral("1:00"));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("work"));

        // Another device ends the session: the mode is free again.
        f.push(f.state(std::nullopt));
        QVERIFY(!f.session->isActive());
        QVERIFY(!f.session->modeLocked());
        QCOMPARE(f.session->phase(), QString());
        QCOMPARE(f.session->countdownText(), QString());
        QCOMPARE(f.session->pomodoroNumber(), 0);
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(f.session->canStartSession());
    }

    void ringsFromTheStateAfterARestart()
    {
        // The app starts after the planned end of a session that runs: the
        // phase rings at once.
        Fixture f(false);
        QVERIFY(connectAccount(f, f.state(work(f.serverNow().addSecs(-70)))));
        f.createSession();
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->isRinging());
        QCOMPARE(f.session->overtimeSeconds(), 10);
        QCOMPARE(f.session->countdownText(), QStringLiteral("+0:10"));

        // Another device confirms Next phase: the alarm stops here too.
        QSignalSpy ringing(f.session.get(), &PomodoroSession::ringingChanged);
        f.push(f.state(shortRest(f.serverNow(), f.serverNow().addSecs(-70))));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(ringing.size(), 1);

        // The rest rings at its end, and stops when another device ends the
        // session.
        f.tick(60);
        QVERIFY(f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("shortRestToWork"));
        f.push(f.state(std::nullopt));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QString());
        QVERIFY(!f.session->isActive());
    }

    void startsAndEndsOnTheServer()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(!f.session->canStartSession());

        // In Timer mode a click is the timer's: it starts an entry, and the
        // mode stays locked while it runs.
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype timerStart = f.last("POST", entriesPath);
        QVERIFY(timerStart >= 0);
        f.transport.respond(timerStart, FakeTransport::answer(200, QJsonDocument(runningEntry(30, f.serverNow())).toJson(QJsonDocument::Compact)));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.session->modeLocked());
        QVERIFY(!f.session->setPomodoroMode(true));
        f.push(f.state(std::nullopt));
        QVERIFY(!f.session->modeLocked());

        // In Pomodoro mode a click starts a session with the chosen project
        // and billable flag, and with the lengths left to the server.
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(f.store.loadPomodoroMode());
        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(f.session->canStartSession());
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype start = f.last("POST", startPath);
        QVERIFY(start >= 0);
        QCOMPARE(f.body(start),
                 (QJsonObject{
                     {QStringLiteral("created_with"), testClientName()},
                     {QStringLiteral("description"), QString()},
                     {QStringLiteral("workspace_id"), 7},
                     {QStringLiteral("project_id"), 11},
                     {QStringLiteral("billable"), true},
                 }));
        QVERIFY(!f.session->canStartSession());
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Ignored);
        QCOMPARE(f.find("POST", startPath).size(), 1);

        const QDateTime began = f.serverNow();
        f.respond(start, f.state(work(began)));
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->modeLocked());
        QVERIFY(!f.session->canStartSession());
        QVERIFY(!f.session->setPomodoroMode(false));
        QCOMPARE(f.session->countdownText(), QStringLiteral("1:00"));

        // End session sends the revision shown. The server drops the short
        // pomodoro and says so.
        f.tick(5);
        QVERIFY(f.session->endSession());
        const qsizetype end = f.last("POST", endPath);
        QCOMPARE(f.body(end), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        const QJsonObject discarded{
            {QStringLiteral("entry_id"), f.entryId},
            {QStringLiteral("start"), iso(began)},
            {QStringLiteral("stop"), iso(began)},
        };
        const QByteArray ended = f.state(std::nullopt, discarded);
        f.respond(end, ended);
        QVERIFY(!f.session->isActive());
        QCOMPARE(f.session->message(), tooShort);
        QVERIFY(!f.session->modeLocked());
        QVERIFY(f.session->canStartSession());

        // The same state from the stream tells nothing new.
        f.session->clearMessage();
        f.push(ended);
        QCOMPARE(f.session->message(), QString());
    }

    void conflictsAndUnknownOutcomesSendNothingAgain()
    {
        Fixture f;
        const QDateTime start = f.serverNow().addSecs(-65);
        QVERIFY(connectAccount(f, f.state(work(start))));
        QVERIFY(f.session->isRinging());

        // Another device confirmed first: the 409 shows its state, and Next
        // phase is not sent again.
        QVERIFY(f.session->confirmNextPhase());
        const qsizetype next = f.last("POST", nextPath);
        QCOMPARE(f.body(next), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        f.respond(next, f.state(shortRest(f.serverNow(), start)), 409);
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        f.tick(1);
        QCOMPARE(f.find("POST", nextPath).size(), 1);
        QCOMPARE(f.session->message(), QString());

        // End session times out: it may have happened, so nothing is sent
        // until a later read shows what the server holds.
        QVERIFY(f.session->endSession());
        const qsizetype end = f.last("POST", endPath);
        const qsizetype readsBefore = f.find("GET", statePath).size();
        f.transport.respond(end, FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QCOMPARE(f.session->message(), QStringLiteral("The Tokkl instance did not answer in time."));
        QVERIFY(f.client.settling());
        QVERIFY(f.session->isActive());
        QVERIFY(!f.session->endSession());
        QVERIFY(!f.session->confirmNextPhase());
        QCOMPARE(f.find("POST", endPath).size(), 1);
        QCOMPARE(f.find("GET", statePath).size(), readsBefore + 1);
        f.respond(f.last("GET", statePath), f.state(std::nullopt));
        QVERIFY(!f.client.settling());
        QVERIFY(!f.session->isActive());
        QCOMPARE(f.find("POST", endPath).size(), 1);
    }

    void anAccountChangeFreesTheControlsOfAnActionLeftUnanswered()
    {
        Fixture f;
        QVERIFY(connectAccount(f, f.state(work(f.serverNow().addSecs(-65)))));
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.find("POST", nextPath).size(), 1);

        // The answer for the first instance never comes. On the second one
        // the session takes actions again.
        QVERIFY(connectAccount(f, f.state(work(f.serverNow().addSecs(-65))), instanceB));
        QVERIFY(f.session->isRinging());
        QVERIFY(f.session->confirmNextPhase());
        const qsizetype next = f.last("POST", nextPath);
        QCOMPARE(f.find("POST", nextPath).size(), 2);
        QVERIFY(f.transport.requests.at(next).url.toString().startsWith(instanceB));
        f.respond(next, f.state(shortRest(f.serverNow(), f.serverNow().addSecs(-65))));
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        QVERIFY(f.session->endSession());
    }

    void keepsCountingWhileOffline()
    {
        Fixture f;
        QVERIFY(connectAccount(f, f.state(work(f.serverNow()))));
        QVERIFY(!f.session->setPomodoroMode(true));

        // The instance is out of reach: End session fails with the
        // connection's message.
        QVERIFY(f.session->endSession());
        f.transport.respond(f.last("POST", endPath), FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QCOMPARE(f.session->message(), QStringLiteral("Could not reach the Tokkl instance."));
        QCOMPARE(f.connection.state(), Connection::Disconnected);

        // The countdown and the alarm go on from the last state.
        QVERIFY(f.session->isActive());
        f.tick(30);
        QCOMPARE(f.session->countdownText(), QStringLiteral("0:30"));
        f.tick(30);
        QVERIFY(f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("workToShortRest"));
    }

    void formatsTheCountdown()
    {
        QCOMPARE(PomodoroSession::formatCountdown(0, false), QStringLiteral("0:00"));
        QCOMPARE(PomodoroSession::formatCountdown(59, false), QStringLiteral("0:59"));
        QCOMPARE(PomodoroSession::formatCountdown(61, true), QStringLiteral("+1:01"));
        QCOMPARE(PomodoroSession::formatCountdown(75 * 60 + 5, true), QStringLiteral("+75:05"));
        QCOMPARE(PomodoroSession::formatCountdown(-3, false), QStringLiteral("0:00"));
    }
};

QTEST_GUILESS_MAIN(PomodoroSessionTest)
#include "pomodorosessiontest.moc"
