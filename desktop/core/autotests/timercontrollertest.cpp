// The timer controller on the server's timer state, driven through a fake
// clock, a scripted transport with scripted streams and a scripted
// credential store.

#include "connection.h"
#include "fakes.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-timer-1");
const QByteArray statePath = "/app/timer";
const QByteArray listPath = "/me/time_entries";

QByteArray meBody(qint64 id, qint64 workspace)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), QStringLiteral("UTC")},
                             {QStringLiteral("default_workspace_id"), workspace},
                             {QStringLiteral("beginning_of_week"), 1},
                         })
        .toJson(QJsonDocument::Compact);
}

QJsonObject entryObject(qint64 id, qint64 workspace, const QString &start, bool running = true, std::optional<qint64> project = std::nullopt)
{
    const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), workspace},
        {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
        {QStringLiteral("billable"), false},
        {QStringLiteral("start"), start},
        {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(begin.addSecs(60).toString(Qt::ISODate))},
        {QStringLiteral("duration"), running ? -begin.toSecsSinceEpoch() : 60},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
}

QByteArray entryBody(qint64 id, qint64 workspace, const QString &start, bool running = true, std::optional<qint64> project = std::nullopt)
{
    return QJsonDocument(entryObject(id, workspace, start, running, project)).toJson(QJsonDocument::Compact);
}

// One stopped entry of GET /me/time_entries?meta=true.
QJsonObject listedEntry(qint64 id, qint64 workspace, std::optional<qint64> project, const QJsonValue &active, bool billable = false)
{
    QJsonObject entry = entryObject(id, workspace, QStringLiteral("2026-10-15T08:00:00Z"), false, project);
    entry.insert(QStringLiteral("project_active"), active);
    entry.insert(QStringLiteral("project_billable"), project ? QJsonValue(billable) : QJsonValue(QJsonValue::Null));
    return entry;
}

QByteArray listBody(const QJsonArray &entries)
{
    return QJsonDocument(entries).toJson(QJsonDocument::Compact);
}

QByteArray projectsBody(qint64 workspace)
{
    return QStringLiteral(R"([{"id":11,"workspace_id":%1,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])")
        .arg(workspace)
        .toUtf8();
}

QJsonObject projectObject(qint64 id, qint64 workspace, const QString &color, bool active = true)
{
    return QJsonObject{{QStringLiteral("id"), id},
                       {QStringLiteral("workspace_id"), workspace},
                       {QStringLiteral("name"), QStringLiteral("P%1").arg(id)},
                       {QStringLiteral("color"), color},
                       {QStringLiteral("active"), active},
                       {QStringLiteral("billable"), false}};
}

QByteArray json(const QJsonObject &object)
{
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

// A page of distinct active projects of the workspace, ids first .. first + count - 1.
QByteArray projectPage(int first, int count, qint64 workspace)
{
    QJsonArray projects;
    for (int id = first; id < first + count; ++id) {
        projects.append(QJsonObject{{QStringLiteral("id"), id},
                                    {QStringLiteral("workspace_id"), workspace},
                                    {QStringLiteral("name"), QStringLiteral("P%1").arg(id)},
                                    {QStringLiteral("active"), true}});
    }
    return QJsonDocument(projects).toJson(QJsonDocument::Compact);
}

const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z"); // 65 s before the fake clock

// An entry of project 11 with the fields a resume copies. The project's
// default is billable, the entry is not. A duration makes it stopped, with
// that duration stored.
QByteArray detailedEntry(qint64 id, const QString &start, std::optional<qint64> duration = std::nullopt)
{
    QJsonObject entry = entryObject(id, 7, start, !duration, 11);
    entry.insert(QStringLiteral("description"), QStringLiteral("Write the report"));
    entry.insert(QStringLiteral("task_id"), 4);
    entry.insert(QStringLiteral("tags"), QJsonArray{QStringLiteral("focus"), QStringLiteral("client")});
    if (duration) {
        const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
        entry.insert(QStringLiteral("stop"), begin.addSecs(*duration).toString(Qt::ISODate));
        entry.insert(QStringLiteral("duration"), *duration);
    }
    return json(entry);
}

// The server's pause chain of the detailed entry, with the seconds its
// stopped entries stored, and the running clone unless paused.
QJsonObject pauseObject(bool paused, qint64 seconds, std::optional<qint64> clone = std::nullopt, qint64 workspace = 7)
{
    return QJsonObject{
        {QStringLiteral("paused"), paused},
        {QStringLiteral("seconds"), seconds},
        {QStringLiteral("workspace_id"), workspace},
        {QStringLiteral("description"), QStringLiteral("Write the report")},
        {QStringLiteral("project_id"), 11},
        {QStringLiteral("task_id"), 4},
        {QStringLiteral("tag_ids"), QJsonArray{3, 5}},
        {QStringLiteral("tags"), QJsonArray{QStringLiteral("client"), QStringLiteral("focus")}},
        {QStringLiteral("billable"), false},
        {QStringLiteral("clone_entry_id"), clone ? QJsonValue(*clone) : QJsonValue(QJsonValue::Null)},
    };
}

// A session in its first work phase, whose open pomodoro started at start
// and is the running entry.
QJsonObject pomodoroObject(qint64 entry, const QString &start)
{
    const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
    return QJsonObject{
        {QStringLiteral("work_minutes"), 25},
        {QStringLiteral("short_rest_minutes"), 5},
        {QStringLiteral("long_rest_minutes"), 15},
        {QStringLiteral("long_rest_every"), 4},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), QStringLiteral("work")},
             {QStringLiteral("start"), start},
             {QStringLiteral("completed"), 0},
             {QStringLiteral("planned_end"), begin.addSecs(25 * 60).toString(Qt::ISODate)},
         }},
        {QStringLiteral("upcoming_phase"), QStringLiteral("shortRest")},
        {QStringLiteral("transition"), QStringLiteral("workToShortRest")},
        {QStringLiteral("number"), 1},
        {QStringLiteral("entry_id"), entry},
        {QStringLiteral("pomodoro_start"), start},
    };
}

// A timer state built at serverTime. running is the running entry as JSON,
// "null" for none.
QByteArray stateJson(qint64 revision, const QDateTime &serverTime, const QByteArray &running, const QJsonValue &pause, const QJsonValue &pomodoro)
{
    return json(QJsonObject{
        {QStringLiteral("revision"), revision},
        {QStringLiteral("server_time"), serverTime.toUTC().toString(Qt::ISODateWithMs)},
        {QStringLiteral("running_entry"), parseJsonBody(running).value_or(QJsonValue())},
        {QStringLiteral("pause"), pause},
        {QStringLiteral("pomodoro"), pomodoro},
        {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
    });
}

QByteArray revisionBody(qint64 revision)
{
    return "{\"revision\":" + QByteArray::number(revision) + "}";
}

QString clockText(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODate);
}
}

class TimerControllerTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        Connection connection{&transport, &store, testClientName()};
        TimerStateClient state{&connection, &clock};
        TimerController timer{&clock};
        QSet<qsizetype> answered;
        qint64 revision = 0; // of the last state built

        Fixture()
        {
            timer.setStateClient(&state);
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

        bool unanswered(qsizetype index) const
        {
            return index >= 0 && !answered.contains(index);
        }

        void respond(qsizetype index, const HttpResponse &response)
        {
            answered.insert(index);
            transport.respond(index, response);
        }

        // The state at the next revision, built on the clock's time: the
        // running entry as JSON ("null" for none), the chain and the session.
        QByteArray nextState(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            return stateJson(++revision, clock.now(), running, pause, pomodoro);
        }

        HttpResponse stateAnswer(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            return FakeTransport::answer(200, nextState(running, pause, pomodoro));
        }

        // Answers the latest state read with the next state; false when that
        // read was answered already.
        bool answerState(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            const qsizetype read = last("GET", statePath);
            if (!unanswered(read)) {
                return false;
            }
            respond(read, stateAnswer(running, pause, pomodoro));
            return true;
        }

        // Sends the next state as an event on the open stream.
        bool push(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            FakeStream *stream = transport.lastStream();
            if (!stream) {
                return false;
            }
            stream->push("event: timer\ndata: " + nextState(running, pause, pomodoro) + "\n\n");
            return true;
        }

        qsizetype stateReads() const
        {
            return find("GET", statePath).size();
        }

        // Requests other than state reads.
        qsizetype otherRequests() const
        {
            return transport.requests.size() - stateReads();
        }
    };

    // Configure token auth for the instance, answer /me, then the state read
    // and the projects read the new context sends.
    static bool connectAccount(Fixture &f,
                               const QString &url = instanceA,
                               qint64 userId = 3,
                               qint64 workspace = 7,
                               const QByteArray &current = entryBody(5, 7, startedAt),
                               const QJsonValue &pause = QJsonValue::Null,
                               const QJsonValue &pomodoro = QJsonValue::Null)
    {
        f.store.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(url);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.respond(before, FakeTransport::answer(200, meBody(userId, workspace)));
        const qsizetype read = f.last("GET", statePath);
        const qsizetype projects = f.last("GET", "/projects");
        if (!f.unanswered(read) || !f.unanswered(projects)) {
            return false;
        }
        f.respond(read, f.stateAnswer(current, pause, pomodoro));
        f.respond(projects, FakeTransport::answer(200, projectsBody(workspace)));
        return f.timer.isConnected();
    }

    // Thirty one-second ticks: while no stream delivers, the state client
    // reads the state again.
    static void poll(Fixture &f)
    {
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
    }

    // A click pauses the running entry. The server answers with the paused
    // chain, which now holds seconds.
    static bool pauseEntry(Fixture &f, qint64 seconds)
    {
        if (!f.timer.isRunning() || !f.timer.toggle()) {
            return false;
        }
        const qsizetype post = f.last("POST", "/timer/pause");
        if (!f.unanswered(post) || f.transport.requests.at(post).body != "{}") {
            return false;
        }
        f.respond(post, f.stateAnswer("null", pauseObject(true, seconds)));
        return f.timer.isPaused() && !f.timer.isRunning() && !f.timer.isBusy();
    }

    // A click resumes the paused chain against the revision shown. The server
    // starts the clone with the id now.
    static bool resumeEntry(Fixture &f, qint64 id, qint64 seconds)
    {
        const qint64 shown = f.revision;
        if (!f.timer.isPaused() || !f.timer.toggle()) {
            return false;
        }
        const qsizetype post = f.last("POST", "/timer/resume");
        if (!f.unanswered(post) || f.transport.requests.at(post).body != revisionBody(shown)) {
            return false;
        }
        f.respond(post, f.stateAnswer(detailedEntry(id, clockText(f.clock.now())), pauseObject(false, seconds, id)));
        return f.timer.isRunning() && !f.timer.isPaused() && !f.timer.isBusy() && f.timer.currentEntry()->id == id;
    }

private Q_SLOTS:
    void exposesContextAndEntry()
    {
        Fixture f;
        QVERIFY(!f.timer.isConnected());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(f.transport.requests.isEmpty());

        QVERIFY(connectAccount(f));
        QCOMPARE(f.timer.workspaceId(), 7);
        QCOMPARE(f.timer.account().value(QStringLiteral("id")).toLongLong(), 3);
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntryVariant().toMap().value(QStringLiteral("id")).toLongLong(), 5);
        QCOMPARE(f.timer.projects().size(), 1);
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QVERIFY(f.timer.canWrite());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isStale());
        QVERIFY(f.timer.errorString().isEmpty());
        // The entry was read before any tick; elapsed is already right.
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01"));

        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);
        QCOMPARE(f.connection.nextProjectId(), std::optional<qint64>(11));
        QVERIFY(f.connection.nextBillable());
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
    }

    void formatsElapsed()
    {
        // Whole minutes: the seconds are dropped, not rounded.
        QCOMPARE(TimerController::formatElapsed(-5), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(0), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(59), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(60), QStringLiteral("0:01"));
        QCOMPARE(TimerController::formatElapsed(3599), QStringLiteral("0:59"));
        QCOMPARE(TimerController::formatElapsed(3600), QStringLiteral("1:00"));
        QCOMPARE(TimerController::formatElapsed(3600 + 61), QStringLiteral("1:01"));
        QCOMPARE(TimerController::formatElapsed(125 * 3600), QStringLiteral("125:00"));
    }

    void systemClockTicksEverySecond()
    {
        SystemClock clock;
        QList<qint64> ticks;
        connect(&clock, &Clock::ticked, this, [&ticks] {
            ticks.append(QDateTime::currentMSecsSinceEpoch());
        });
        QVERIFY(QTest::qWaitFor(
            [&] {
                return ticks.size() >= 3;
            },
            5000));
        // Re-aimed at each second boundary, so the interval stays near 1 s.
        for (qsizetype i = 1; i < ticks.size(); ++i) {
            const qint64 interval = ticks.at(i) - ticks.at(i - 1);
            QVERIFY2(interval > 500 && interval < 1500, qPrintable(QString::number(interval)));
        }
        QVERIFY(qAbs(clock.now().msecsTo(QDateTime::currentDateTimeUtc())) < 1000);
        QCOMPARE(clock.now().timeSpec(), Qt::UTC);
    }

    void ticksFromTheServerStartWithoutDrift()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QSignalSpy elapsed(&f.timer, &TimerController::elapsedChanged);

        // Late, uneven ticks: elapsed always follows the clock, not the tick count.
        const QDateTime start = QDateTime::fromString(startedAt, Qt::ISODate);
        for (int i = 0; i < 25; ++i) {
            f.clock.advance(i % 2 ? 1400 : 700);
            QCOMPARE(f.timer.elapsedSeconds(), start.secsTo(f.clock.current));
        }
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 25); // 25 ticks covered 25.9 s
        QVERIFY(elapsed.count() > 0);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01"));

        // A clock before the start (skew) never shows negative time.
        f.clock.current = start.addSecs(-30);
        f.clock.advance(0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
    }

    void sleepGapKeepsTimeAndRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.clock.advance(1000);
        const qsizetype requests = f.transport.requests.size();

        // Two hours asleep: the next tick arrives late.
        const qsizetype streams = f.transport.streams.size();
        f.clock.advance(2 * 3600 * 1000);
        QCOMPARE(f.timer.elapsedSeconds(), 2 * 3600 + 66);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("2:01"));
        // The state client reads the state and replaces the stream at once.
        QCOMPARE(f.transport.requests.size(), requests + 1);
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QCOMPARE(f.transport.streams.size(), streams + 1);

        // The web app stopped the timer meanwhile.
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));

        // The explicit hook reads the projects too.
        f.timer.resumed();
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QVERIFY(f.unanswered(f.last("GET", "/projects")));
    }

    void pollsWhileNoStreamDelivers()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(!f.timer.isRunning());
        const qsizetype reads = f.find("GET", statePath).size();

        for (int i = 0; i < 29; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads);
        f.clock.advance(1000);
        QCOMPARE(f.find("GET", statePath).size(), reads + 1);

        // A timer started in the web app appears.
        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T09:00:10Z"))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 9);
        QCOMPARE(f.timer.elapsedSeconds(), 20);

        // Ticks while a read is outstanding do not stack requests.
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 2);
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 2);

        // Edited in the web app: the panel shows the new start.
        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QCOMPARE(f.timer.elapsedSeconds(), 3690);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:01"));

        // A clock set far back counts as a resume and reads at once.
        f.clock.current = f.clock.current.addSecs(-20);
        f.clock.advance(0);
        QCOMPARE(f.find("GET", statePath).size(), reads + 3);

        // Once the stream delivers, its events replace the polls.
        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QVERIFY(f.push());
        QVERIFY(!f.timer.isRunning());
        for (int i = 0; i < 90; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 3);
    }

    void startWaitsForTheFirstStateRead()
    {
        Fixture f;
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.timer.isConnected());

        // The first read has not answered: a server timer may be running.
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QCOMPARE(f.find("POST", "/time_entries").size(), 0);

        // It fails: start stays disabled.
        f.respond(f.last("GET", statePath), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QCOMPARE(f.find("POST", "/time_entries").size(), 0);

        // The next read succeeds and enables it.
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QVERIFY(f.answerState("null"));
        if (f.unanswered(f.last("GET", "/projects"))) {
            f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        }
        QVERIFY(f.timer.canWrite());
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
    }

    void startSendsTheAgreedEntry()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceB, 3, 7, "null"));
        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);
        f.clock.current = QDateTime(QDate(2026, 10, 16), QTime(9, 15, 30), QTimeZone::fromSecondsAheadOfUtc(7200)).toUTC();

        QSignalSpy status(&f.timer, &TimerController::statusChanged);
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        // Repeated clicks while the start runs send nothing.
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);

        const qsizetype post = f.last("POST", "/time_entries");
        const HttpRequest request = f.transport.requests.at(post);
        QCOMPARE(request.url.toString(), QStringLiteral("https://b.example.test/tokkl/api/v9/workspaces/7/time_entries"));
        const QJsonObject body = QJsonDocument::fromJson(request.body).object();
        QCOMPARE(body.value(QStringLiteral("duration")).toInt(), -1);
        QCOMPARE(body.value(QStringLiteral("start")).toString(), QStringLiteral("2026-10-16T07:15:30Z"));
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), testClientName());
        QVERIFY(body.value(QStringLiteral("description")).isString());
        QCOMPARE(body.value(QStringLiteral("description")).toString(), QString());
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(body.value(QStringLiteral("workspace_id")).toInteger(), 7);

        // Nonbillable and no project are sent explicitly too.
        f.respond(post, FakeTransport::answer(200, entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"))));
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.currentEntry()->id, 21);
        // The action is followed by a read.
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QVERIFY(f.answerState(entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"))));

        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"), false)));
        QVERIFY(f.answerState("null"));
        // The stopped entry had no project, so the next start has none either.
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QVERIFY(f.timer.start());
        const QJsonObject plain = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", "/time_entries")).body).object();
        QVERIFY(plain.value(QStringLiteral("project_id")).isNull());
        QVERIFY(plain.contains(QStringLiteral("billable")));
        QCOMPARE(plain.value(QStringLiteral("billable")).toBool(true), false);
    }

    void stopPatchesTheRunningEntry()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
        const HttpRequest request = f.transport.requests.at(f.last("PATCH", "/stop"));
        QCOMPARE(request.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5/stop"));
        QVERIFY(request.body.isEmpty());

        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
        QVERIFY(f.unanswered(f.last("GET", statePath)));
    }

    void pauseAndResumeKeepTheChainTotal()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        // A click pauses on the server; clicks while it runs are ignored.
        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.resume());
        QVERIFY(!f.timer.pause());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);
        const qsizetype pause = f.last("POST", "/timer/pause");
        QCOMPARE(f.transport.requests.at(pause).url.path(), QStringLiteral("/api/app/timer/pause"));
        QCOMPARE(f.transport.requests.at(pause).body, QByteArray("{}"));
        QVERIFY(f.find("PATCH", "/stop").isEmpty());
        f.respond(pause, f.stateAnswer("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(chain.count() > 0);
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.elapsedText(), TimerController::formatElapsed(65));

        // Frozen while paused.
        for (int i = 0; i < 10; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        // A click resumes against the revision shown, and the clone counts
        // on from the chain's seconds. The paused entry's project gave the
        // next start its billable default.
        QVERIFY(f.timer.billable());
        QVERIFY(resumeEntry(f, 6, 65));
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QVERIFY(f.find("POST", "/time_entries").isEmpty());
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        for (int i = 0; i < 5; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 70);
        QCOMPARE(f.timer.chainSeconds(), 65);

        // A second cycle: the server added what it stored for the clone.
        QVERIFY(pauseEntry(f, 69));
        QCOMPARE(f.timer.chainSeconds(), 69);
        QCOMPARE(f.timer.elapsedSeconds(), 69);
        QVERIFY(resumeEntry(f, 7, 69));
        for (int i = 0; i < 3; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 72);

        // Stop is a v9 stop of the clone, and the chain ends with it at once.
        const QString cloneStart = clockText(f.clock.now().addSecs(-3));
        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("PATCH", "/stop")).url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/7/stop"));
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, detailedEntry(7, cloneStart, 3)));
        QVERIFY(!f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QVERIFY(f.answerState());
        QCOMPARE(f.timer.chainSeconds(), 0);

        // The next click starts a fresh entry with the stop's default: the
        // project and its billable default.
        QVERIFY(f.timer.toggle());
        const QJsonObject fresh = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", "/time_entries")).body).object();
        QCOMPARE(fresh.value(QStringLiteral("description")).toString(), QString());
        QVERIFY(!fresh.contains(QStringLiteral("task_id")));
        QVERIFY(!fresh.contains(QStringLiteral("tags")));
        QCOMPARE(fresh.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(fresh.value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
        QCOMPARE(f.find("POST", "/timer/pause").size(), 2);
        QCOMPARE(f.find("POST", "/timer/resume").size(), 2);
    }

    // The total of a chain resumed elsewhere before this device connected,
    // corrected for the server's clock.
    void chainTotalComesFromTheState()
    {
        Fixture f;
        const QString cloneStart = clockText(f.clock.now().addSecs(-10));
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(6, cloneStart), pauseObject(false, 65, 6)));
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 75);

        // The server's clock runs 5 s ahead of this one.
        poll(f);
        f.respond(f.last("GET", statePath),
                  FakeTransport::answer(200, stateJson(++f.revision, f.clock.now().addSecs(5), detailedEntry(6, cloneStart), pauseObject(false, 65, 6), QJsonValue::Null)));
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 40 + 5);
        f.clock.advance(1000);
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 41 + 5);

        // Paused elsewhere: frozen at what the server stored.
        poll(f);
        QVERIFY(f.answerState("null", pauseObject(true, 110)));
        QCOMPARE(f.timer.chainSeconds(), 110);
        QCOMPARE(f.timer.elapsedSeconds(), 110);
    }

    void choicesAreLockedWhilePaused()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QSignalSpy choice(&f.timer, &TimerController::choiceChanged);
        QVERIFY(pauseEntry(f, 65));
        QVERIFY(choice.count() > 0);
        QVERIFY(f.timer.canWrite());
        // The project and billable flag are the chain's.
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.timer.chosenBillable(), false);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.entryProject()->id, 11);

        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QVERIFY(!f.timer.chooseProject(11));
        QVERIFY(!f.timer.chooseBillable(true));
        QVERIFY(!f.timer.start());
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.timer.chosenBillable(), false);

        // Stop while paused discards the chain against the revision shown.
        const qint64 shown = f.revision;
        QVERIFY(f.timer.stop());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", "/timer/discard").size(), 1);
        const qsizetype discard = f.last("POST", "/timer/discard");
        QCOMPARE(f.transport.requests.at(discard).url.path(), QStringLiteral("/api/app/timer/discard"));
        QCOMPARE(f.transport.requests.at(discard).body, revisionBody(shown));
        f.respond(discard, f.stateAnswer());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        // Choices work again.
        QCOMPARE(f.timer.chosenBillable(), true);
        QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(f.timer.chooseBillable(true));
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(!f.timer.entryProject().has_value());
        QCOMPARE(f.transport.requests.size(), requests + 1);
    }

    void refusedResumeStaysPaused()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));

        // The project or task went while paused: nothing was created.
        QVERIFY(f.timer.resume());
        f.respond(f.last("POST", "/timer/resume"), FakeTransport::answer(404, "\"Project not found\""));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        // The read after the refusal keeps the message and the status.
        QVERIFY(f.answerState("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        poll(f);
        QVERIFY(f.answerState("null", pauseObject(true, 65)));
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QVERIFY(f.timer.isPaused());
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));

        // Stop discards the chain and clears the message; the next click
        // starts a fresh entry.
        QVERIFY(f.timer.stop());
        QCOMPARE(f.timer.errorString(), QString());
        f.respond(f.last("POST", "/timer/discard"), f.stateAnswer());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
    }

    // Another device acted first: the 409 carries the server's state, which
    // the timer shows at once. Nothing is sent again, and the message stays
    // until the next action.
    void conflictAdoptsTheServerState()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        const qint64 shown = f.revision;
        QVERIFY(f.timer.resume());
        const qsizetype post = f.last("POST", "/timer/resume");
        QCOMPARE(f.transport.requests.at(post).body, revisionBody(shown));
        f.respond(post, FakeTransport::answer(409, f.nextState(detailedEntry(6, clockText(f.clock.now().addSecs(-4))), pauseObject(false, 65, 6))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.currentEntry()->id, 6);
        QCOMPARE(f.timer.elapsedSeconds(), 69);
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.timer.canWrite());

        poll(f);
        QVERIFY(f.answerState(detailedEntry(6, clockText(f.clock.now().addSecs(-34))), pauseObject(false, 65, 6)));
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);

        // The next click pauses the clone, and clears the message.
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/pause").size(), 2);
    }

    void refusedStartKeepsItsMessage()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(404, "\"Project not found\""));
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.timer.canWrite());

        // The next choice is a user action and clears it.
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.errorString(), QString());
        QCOMPARE(f.timer.status(), TimerController::Ready);

        // So does a start that succeeds, after another refusal.
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(404, "\"Project not found\""));
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QVERIFY(f.timer.start());
        QCOMPARE(f.timer.errorString(), QString());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(200, entryBody(21, 7, clockText(f.clock.now()))));
        QVERIFY(f.answerState(entryBody(21, 7, clockText(f.clock.now()))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.errorString(), QString());
        QCOMPARE(f.timer.status(), TimerController::Ready);
    }

    void ambiguousResumeIsNeverReplayed_data()
    {
        QTest::addColumn<bool>("created");
        QTest::newRow("clone created") << true;
        QTest::newRow("nothing created") << false;
    }

    void ambiguousResumeIsNeverReplayed()
    {
        QFETCH(bool, created);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        const QString resumedAt = clockText(f.clock.now());
        QVERIFY(f.timer.resume());
        f.respond(f.last("POST", "/timer/resume"), FakeTransport::failure(HttpResponse::Outcome::Timeout, QStringLiteral("timed out")));
        QVERIFY(f.timer.isBusy());
        QCOMPARE(f.timer.status(), TimerController::Busy);
        QVERIFY(!f.timer.errorString().isEmpty());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());

        // The read sent after the failure tells what the server did.
        if (created) {
            QVERIFY(f.answerState(detailedEntry(6, resumedAt), pauseObject(false, 65, 6)));
        } else {
            QVERIFY(f.answerState("null", pauseObject(true, 65)));
        }
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QCOMPARE(f.timer.isRunning(), created);
        QCOMPARE(f.timer.isPaused(), !created);
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        poll(f);
        if (created) {
            QVERIFY(f.answerState(detailedEntry(6, resumedAt), pauseObject(false, 65, 6)));
        } else {
            QVERIFY(f.answerState("null", pauseObject(true, 65)));
        }
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QCOMPARE(f.timer.elapsedSeconds(), created ? 95 : 65);
    }

    // A pause with no answer, while a poll is on its way. The poll may have
    // been answered before the pause, so only a read sent after the failure
    // settles it. A failed read is tried again.
    void unansweredPauseIsSettledByTheNextState_data()
    {
        QTest::addColumn<bool>("paused");
        QTest::newRow("the server paused") << true;
        QTest::newRow("nothing happened") << false;
    }

    void unansweredPauseIsSettledByTheNextState()
    {
        QFETCH(bool, paused);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        poll(f);
        const qsizetype early = f.last("GET", statePath);
        QVERIFY(f.unanswered(early));
        QVERIFY(f.timer.toggle());
        f.respond(f.last("POST", "/timer/pause"), FakeTransport::failure(HttpResponse::Outcome::Timeout, QStringLiteral("timed out")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QVERIFY(f.timer.isRunning());

        f.respond(early, f.stateAnswer(detailedEntry(5, startedAt)));
        QVERIFY(f.timer.isBusy());
        const qsizetype later = f.last("GET", statePath);
        QVERIFY(later > early);
        QVERIFY(f.unanswered(later));
        f.respond(later, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("reset")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());

        poll(f);
        if (paused) {
            QVERIFY(f.answerState("null", pauseObject(true, 66)));
        } else {
            QVERIFY(f.answerState(detailedEntry(5, startedAt)));
        }
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.isPaused(), paused);
        QCOMPARE(f.timer.isRunning(), !paused);
        QCOMPARE(f.timer.elapsedSeconds(), paused ? 66 : QDateTime::fromString(startedAt, Qt::ISODate).secsTo(f.clock.now()));
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);

        // The next click sends one request: a resume, or a new pause.
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", "/timer/resume").size(), paused ? 1 : 0);
        QCOMPARE(f.find("POST", "/timer/pause").size(), paused ? 1 : 2);
    }

    // A stop, a discard or a billable edit with no answer: busy until the
    // read after it, and never sent again.
    void unknownWriteIsNeverReplayed_data()
    {
        QTest::addColumn<QString>("write");
        QTest::newRow("stop") << QStringLiteral("stop");
        QTest::newRow("discard") << QStringLiteral("discard");
        QTest::newRow("billable") << QStringLiteral("billable");
    }

    void unknownWriteIsNeverReplayed()
    {
        QFETCH(QString, write);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QByteArray method = "PATCH";
        QByteArray path = "/stop";
        if (write == QLatin1String("discard")) {
            QVERIFY(pauseEntry(f, 65));
            QVERIFY(f.timer.stop());
            method = "POST";
            path = "/timer/discard";
        } else if (write == QLatin1String("billable")) {
            QVERIFY(f.timer.chooseBillable(true));
            method = "PUT";
            path = "/time_entries/5";
        } else {
            QVERIFY(f.timer.stop());
        }
        const qsizetype sent = f.last(method, path);
        QVERIFY(f.unanswered(sent));
        f.respond(sent, FakeTransport::answer(502, "\"Bad gateway\""));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QVERIFY(!f.timer.chooseBillable(false));

        QVERIFY(f.answerState(write == QLatin1String("billable") ? detailedEntry(5, startedAt) : QByteArray("null")));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find(method, path).size(), 1);
    }

    // A pause, resume and discard made on another device arrive with the
    // stream's events; nothing is read for them.
    void otherDevicesArriveOnTheStream()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(f.push(detailedEntry(5, startedAt)));
        QVERIFY(f.state.streaming());
        const qsizetype reads = f.stateReads();

        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        QSignalSpy entry(&f.timer, &TimerController::currentEntryChanged);
        QVERIFY(f.push("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(chain.count(), 1);
        QCOMPARE(entry.count(), 1);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(!f.timer.chosenBillable());
        poll(f);
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        QVERIFY(f.push(detailedEntry(6, clockText(f.clock.now())), pauseObject(false, 65, 6)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 6);
        for (int i = 0; i < 5; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 70);

        // A chain in another workspace is not shown here.
        QVERIFY(f.push("null", pauseObject(true, 70, std::nullopt, 9)));
        QVERIFY(!f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        QVERIFY(f.push());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.stateReads(), reads);
        QVERIFY(f.find("POST", "/timer/pause").isEmpty());
    }

    // While a session runs, its open pomodoro is the session's: the timer
    // reports nothing running, and its actions do nothing.
    void sessionOwnsTheRunningEntry()
    {
        Fixture f;
        QSignalSpy session(&f.timer, &TimerController::sessionActiveChanged);
        const QString start = clockText(f.clock.now().addSecs(-120));
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(41, 7, start, true, 11), QJsonValue::Null, pomodoroObject(41, start)));
        QVERIFY(f.timer.isSessionActive());
        QCOMPARE(session.count(), 1);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QVERIFY(f.timer.currentEntryVariant().isNull());
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QVERIFY(!f.timer.pause());
        QVERIFY(!f.timer.resume());
        QCOMPARE(f.transport.requests.size(), requests);

        // The session ends on another device: the timer is free again.
        poll(f);
        QVERIFY(f.answerState());
        QVERIFY(!f.timer.isSessionActive());
        QCOMPARE(session.count(), 2);
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
    }

    void newGenerationEndsTheChain_data()
    {
        QTest::addColumn<bool>("signOut");
        QTest::newRow("other instance") << false;
        QTest::newRow("secret removed") << true;
    }

    void newGenerationEndsTheChain()
    {
        QFETCH(bool, signOut);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        if (signOut) {
            const QString key = credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString());
            f.store.secrets.remove(key);
            Q_EMIT f.store.secretChanged(key);
        } else {
            f.connection.setInstanceUrl(instanceB);
        }
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QVERIFY(chain.count() > 0);
    }

    void projectIsLockedWhileRunning()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.timer.canWrite());
        const QVariantMap before = f.timer.currentEntryVariant().toMap();
        const qsizetype requests = f.transport.requests.size();
        QSignalSpy selection(&f.timer, &TimerController::selectionChanged);

        QVERIFY(!f.timer.chooseProject(11));
        QVERIFY(!f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.timer.currentEntryVariant().toMap(), before);
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QCOMPARE(selection.count(), 0);
        QVERIFY(!f.timer.isBusy());

        // Billable still edits the running entry, with billable alone.
        QVERIFY(f.timer.chooseBillable(true));
        const qsizetype put = f.last("PUT", "/time_entries/5");
        QVERIFY(f.unanswered(put));
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(put).body).object(), QJsonObject({{QStringLiteral("billable"), true}}));

        // Stopped, the project is a choice again.
        f.respond(put, FakeTransport::answer(200, entryBody(5, 7, startedAt)));
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        QVERIFY(f.answerState("null"));
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        QCOMPARE(f.find("PUT", "/time_entries/5").size(), 1);
    }

    void panelStopDefaultsToTheEntryProject()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        QVERIFY(f.find("GET", listPath).isEmpty());
        QVERIFY(f.timer.selectedProjectId().isNull());

        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false, 11)));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        QVERIFY(f.timer.billable());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);

        // The read after the stop changes nothing, and the next start sends it.
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        QVERIFY(f.find("GET", listPath).isEmpty());
        QVERIFY(f.timer.start());
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", "/time_entries")).body).object();
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
    }

    void polledStopDefaultsToTheEntryProject()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        poll(f);
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        QVERIFY(f.timer.billable());
    }

    void stopWithoutAnActiveProjectGivesNoProject_data()
    {
        QTest::addColumn<QByteArray>("running");
        QTest::addColumn<int>("lookupStatus");
        QTest::addColumn<QByteArray>("lookup");
        QTest::newRow("archived") << entryBody(5, 7, startedAt, true, 33) << 200
                                  << QJsonDocument(QJsonObject{{QStringLiteral("id"), 33},
                                                               {QStringLiteral("workspace_id"), 7},
                                                               {QStringLiteral("name"), QStringLiteral("Legacy")},
                                                               {QStringLiteral("active"), false},
                                                               {QStringLiteral("billable"), true}})
                                         .toJson(QJsonDocument::Compact);
        QTest::newRow("deleted") << entryBody(5, 7, startedAt, true, 44) << 404 << QByteArray("\"Project not found\"");
        QTest::newRow("no project") << entryBody(5, 7, startedAt) << 0 << QByteArray();
    }

    void stopWithoutAnActiveProjectGivesNoProject()
    {
        QFETCH(QByteArray, running);
        QFETCH(int, lookupStatus);
        QFETCH(QByteArray, lookup);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, running));
        if (lookupStatus != 0) {
            f.respond(f.last("GET", "/projects/" + QByteArray::number(lookupStatus == 200 ? 33 : 44)), FakeTransport::answer(lookupStatus, lookup));
        }
        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);

        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
    }

    void connectDefaultsToTheLastEntryProject_data()
    {
        QTest::addColumn<QByteArray>("list");
        QTest::addColumn<QVariant>("project");
        QTest::addColumn<bool>("billable");
        const QVariant none = QVariant::fromValue(nullptr);
        QTest::newRow("active") << listBody({listedEntry(8, 7, 11, true, true), listedEntry(6, 7, 12, true)}) << QVariant(qint64(11)) << true;
        QTest::newRow("active, nonbillable") << listBody({listedEntry(8, 7, 12, true, false)}) << QVariant(qint64(12)) << false;
        QTest::newRow("archived") << listBody({listedEntry(8, 7, 33, false, true), listedEntry(6, 7, 11, true)}) << none << false;
        QTest::newRow("unknown state") << listBody({listedEntry(8, 7, 11, QJsonValue::Null)}) << none << false;
        QTest::newRow("no project") << listBody({listedEntry(8, 7, std::nullopt, QJsonValue::Null), listedEntry(6, 7, 11, true)}) << none << false;
        QTest::newRow("another workspace") << listBody({listedEntry(8, 9, 11, true, true)}) << none << false;
        QTest::newRow("empty") << QByteArray("[]") << none << false;
    }

    void connectDefaultsToTheLastEntryProject()
    {
        QFETCH(QByteArray, list);
        QFETCH(QVariant, project);
        QFETCH(bool, billable);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QCOMPARE(f.find("GET", listPath).size(), 1);
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.unanswered(read));
        const QUrl url = f.transport.requests.at(read).url;
        QCOMPARE(url.path(), QStringLiteral("/api/v9/me/time_entries"));
        QCOMPARE(url.query(), QStringLiteral("meta=true"));

        QSignalSpy choice(&f.timer, &TimerController::choiceChanged);
        f.respond(read, FakeTransport::answer(200, list));
        if (project.isNull()) {
            QVERIFY(f.timer.selectedProjectId().isNull());
        } else {
            QCOMPARE(f.timer.selectedProjectId().toLongLong(), project.toLongLong());
            QVERIFY(choice.count() > 0);
        }
        QCOMPARE(f.timer.billable(), billable);

        // Polls that keep seeing nothing running neither ask again nor change it.
        f.timer.setSelectedProjectId(QVariant::fromValue(nullptr));
        poll(f);
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.find("GET", listPath).size(), 1);
        QVERIFY(f.timer.selectedProjectId().isNull());
    }

    void connectWithARunningEntryAsksNothing()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        poll(f);
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QVERIFY(f.find("GET", listPath).isEmpty());
    }

    void manualPickWinsOverTheConnectDefault_data()
    {
        QTest::addColumn<QString>("pick");
        QTest::newRow("project") << QStringLiteral("project");
        QTest::newRow("billable") << QStringLiteral("billable");
    }

    void manualPickWinsOverTheConnectDefault()
    {
        QFETCH(QString, pick);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.unanswered(read));

        // Picked before the read answers: the pick stays.
        if (pick == QLatin1String("project")) {
            QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        } else {
            QVERIFY(f.timer.chooseBillable(true));
        }
        f.respond(read, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.selectedProjectId().isNull());
        QCOMPARE(f.timer.billable(), pick == QLatin1String("billable"));

        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chooseBillable(false));
        poll(f);
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.find("GET", listPath).size(), 1);
        QVERIFY(f.timer.start());
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", "/time_entries")).body).object();
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(true), false);
    }

    void startBeforeTheConnectDefaultKeepsItsChoice()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(200, entryBody(21, 7, startedAt)));
        f.respond(read, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
    }

    void connectDefaultOfAnOlderGenerationIsIgnored()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype oldRead = f.last("GET", listPath);
        QVERIFY(connectAccount(f, instanceB, 4, 7, "null"));
        const qsizetype newRead = f.last("GET", listPath);
        QVERIFY(newRead > oldRead);
        f.respond(oldRead, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        f.respond(newRead, FakeTransport::answer(200, listBody({listedEntry(9, 7, 11, true, false)})));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        QVERIFY(!f.timer.billable());
    }

    void stopBeforeTheProjectListKeepsItsDefault_data()
    {
        QTest::addColumn<bool>("pick");
        QTest::newRow("default") << false;
        QTest::newRow("manual pick in between") << true;
    }

    void stopBeforeTheProjectListKeepsItsDefault()
    {
        QFETCH(bool, pick);
        Fixture f;
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == 1;
        }));
        f.respond(0, FakeTransport::answer(200, meBody(3, 7)));
        const qsizetype projects = f.last("GET", "/projects");
        QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 11)));
        QVERIFY(f.unanswered(projects));
        QVERIFY(f.timer.canWrite());

        // The stop answers before the project list.
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false, 11)));
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        if (pick) {
            QVERIFY(f.timer.chooseBillable(true));
        }

        f.respond(projects, FakeTransport::answer(200, projectsBody(7)));
        if (pick) {
            QVERIFY(f.timer.selectedProjectId().isNull());
            QVERIFY(f.timer.billable());
        } else {
            QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
            QVERIFY(f.timer.billable());
        }
    }

    void stopDefaultsToTheProjectTheServerStopped()
    {
        Fixture f;
        const QByteArray projects = "[" + json(projectObject(11, 7, QStringLiteral("#06aaf5"))) + "," + json(projectObject(12, 7, QStringLiteral("#9e5bd9"))) + "]";
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        f.timer.refresh();
        QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 11)));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projects));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);

        // The web moved the entry to project 12 since the last read.
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false, 12)));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 12);
        QVERIFY(!f.timer.billable());
    }

    void reconnectReplacesAnAutomaticDefault_data()
    {
        QTest::addColumn<bool>("pick");
        QTest::newRow("automatic default") << false;
        QTest::newRow("manual pick") << true;
    }

    void reconnectReplacesAnAutomaticDefault()
    {
        QFETCH(bool, pick);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
        if (pick) {
            QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        }

        // Meanwhile an entry on project 12 ran and stopped elsewhere.
        const qsizetype before = f.transport.requests.size();
        f.timer.reconnect();
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(read >= before);
        QVERIFY(f.unanswered(read));
        f.respond(read, f.stateAnswer());
        if (pick) {
            QCOMPARE(f.find("GET", listPath).size(), 1);
            QVERIFY(f.timer.selectedProjectId().isNull());
            QVERIFY(!f.timer.billable());
            return;
        }
        QCOMPARE(f.find("GET", listPath).size(), 2);
        f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(9, 7, 12, true, false), listedEntry(8, 7, 11, true, true)})));
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 12);
        QVERIFY(!f.timer.billable());
    }

    void stoppedConflictReconciles_data()
    {
        QTest::addColumn<int>("status");
        QTest::addColumn<QByteArray>("body");
        QTest::newRow("already stopped") << 409 << QByteArray("\"Time entry already stopped\"");
        QTest::newRow("deleted") << 404 << QByteArray("\"Time entry not found\"");
    }

    void stoppedConflictReconciles()
    {
        QFETCH(int, status);
        QFETCH(QByteArray, body);
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(status, body));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.errorString().isEmpty());
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));

        f.respond(read, f.stateAnswer());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
        QVERIFY(f.timer.canWrite());
    }

    void ambiguousStartIsNeverReplayed_data()
    {
        QTest::addColumn<bool>("serverStarted");
        QTest::addColumn<int>("failure"); // 0 timeout, 1 network, 2 HTTP 502, 3 unreadable 200
        for (int failure = 0; failure < 4; ++failure) {
            QTest::addRow("started, failure %d", failure) << true << failure;
            QTest::addRow("not started, failure %d", failure) << false << failure;
        }
    }

    void ambiguousStartIsNeverReplayed()
    {
        QFETCH(bool, serverStarted);
        QFETCH(int, failure);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", "/time_entries");
        const HttpResponse responses[] = {
            FakeTransport::failure(HttpResponse::Outcome::Timeout),
            FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Connection refused")),
            FakeTransport::answer(502, "\"Bad gateway\""),
            FakeTransport::answer(200, "{\"unexpected\":true}"),
        };
        f.respond(post, responses[failure]);

        // Unknown outcome: busy until a read shows the server state.
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.errorString().isEmpty());
        qsizetype read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));

        // The reconciling read fails too: still busy, nothing replayed.
        f.respond(read, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Network unreachable")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(f.timer.isStale());
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));
        f.respond(read, f.stateAnswer(serverStarted ? entryBody(30, 7, QStringLiteral("2026-10-16T09:00:00Z")) : QByteArray("null")));

        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isStale());
        QCOMPARE(f.timer.isRunning(), serverStarted);
        QCOMPARE(f.timer.canWrite(), true);
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
    }

    void lateRepliesCannotOverwriteNewerState()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        // A poll is in flight when the user starts the timer.
        poll(f);
        const qsizetype stalePoll = f.last("GET", statePath);
        QVERIFY(f.unanswered(stalePoll));
        const qint64 before = f.revision;
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:01:01Z"))));
        QCOMPARE(f.timer.currentEntry()->id, 40);

        // The poll answers late, with the state the start was sent against.
        f.respond(stalePoll, FakeTransport::answer(200, stateJson(before, f.clock.now(), "null", QJsonValue::Null, QJsonValue::Null)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 40);

        // The read after the start shows the newer state, and a later one
        // replaces it.
        const qsizetype fresh = f.last("GET", statePath);
        QVERIFY(fresh != stalePoll);
        QVERIFY(f.unanswered(fresh));
        f.respond(fresh, f.stateAnswer(entryBody(40, 7, QStringLiteral("2026-10-16T09:01:01Z"))));
        QCOMPARE(f.timer.currentEntry()->id, 40);
        poll(f);
        QVERIFY(f.answerState());
        QVERIFY(!f.timer.isRunning());
    }

    void transientFailureKeepsStaleDataAndRecovers()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QVERIFY(f.timer.isStale());
        QVERIFY(f.timer.isConnected());
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.connectionState(), Connection::Disconnected);
        QVERIFY(!f.timer.errorString().isEmpty());
        // The stale entry keeps ticking from its start.
        f.clock.advance(1000);
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 31);

        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        const qsizetype projectsBefore = f.find("GET", "/projects").size();
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isStale());
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.errorString().isEmpty());
        // Our own read brought the connection back; it is not read twice,
        // and the reconnection reads the projects.
        QCOMPARE(f.find("GET", "/projects").size(), projectsBefore + 1);
        QVERIFY(!f.unanswered(f.last("GET", statePath)));
    }

    void reconnectionRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(503, "\"Unavailable\""));
        QCOMPARE(f.timer.connectionState(), Connection::Disconnected);
        const qsizetype reads = f.find("GET", statePath).size();

        f.connection.refreshAccount();
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QCOMPARE(f.find("GET", statePath).size(), reads + 1);
        QVERIFY(f.answerState(entryBody(6, 7, startedAt)));
        QCOMPARE(f.timer.currentEntry()->id, 6);
    }

    void authenticationFailureClears_data()
    {
        QTest::addColumn<int>("status");
        QTest::newRow("401") << 401;
        QTest::newRow("403 on the state") << 403;
    }

    void authenticationFailureClears()
    {
        QFETCH(int, status);
        Fixture f;
        QVERIFY(connectAccount(f));
        f.timer.setSelectedProjectId(11);
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(status, "\"Incorrect username and/or password\""));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.isStale());
        QVERIFY(!f.timer.canWrite());
        QCOMPARE(f.timer.connectionState(), Connection::AuthenticationFailed);
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));

        const qsizetype requests = f.transport.requests.size();
        for (int i = 0; i < 90; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.transport.requests.size(), requests);
    }

    void unauthorizedWriteClears()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(401, "\"Unauthorized\""));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
    }

    void rateLimitCooldown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(429, "\"Too many requests\"", "1"));
        QCOMPARE(f.timer.connectionState(), Connection::RateLimited);
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.errorString().isEmpty());

        // No polls, resumes or starts during the cooldown.
        const qsizetype requests = f.transport.requests.size();
        for (int i = 0; i < 31; ++i) {
            f.clock.advance(1000);
        }
        f.timer.resumed();
        QVERIFY(!f.timer.start());
        QCOMPARE(f.transport.requests.size(), requests);

        // The connection's cooldown runs on real time; its end reads again.
        QVERIFY(QTest::qWaitFor(
            [&] {
                return f.timer.connectionState() == Connection::Connected;
            },
            5000));
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QVERIFY(f.transport.requests.size() > requests);
    }

    void rateLimitedStartIsNotReplayed()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(429, "\"Too many requests\"", "1"));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(QTest::qWaitFor(
            [&] {
                return f.timer.connectionState() == Connection::Connected;
            },
            5000));
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
    }

    void workspaceForbiddenBlocksWrites_data()
    {
        QTest::addColumn<QByteArray>("trigger"); // the request that answers 403
        QTest::newRow("projects") << QByteArray("projects");
        QTest::newRow("start") << QByteArray("start");
        QTest::newRow("stop") << QByteArray("stop");
    }

    void workspaceForbiddenBlocksWrites()
    {
        QFETCH(QByteArray, trigger);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, trigger == "start" ? QByteArray("null") : entryBody(5, 7, startedAt)));
        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);

        const QByteArray forbidden("\"User does not have access to this resource.\"");
        if (trigger == "projects") {
            f.timer.refresh();
            QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
            f.respond(f.last("GET", "/projects"), FakeTransport::answer(403, forbidden));
        } else if (trigger == "start") {
            QVERIFY(f.timer.start());
            f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(403, forbidden));
        } else {
            QVERIFY(f.timer.stop());
            f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(403, forbidden));
        }

        // Workspace data is gone and writes are blocked; the account stays.
        QVERIFY(f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isConnected());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.errorString().contains(QStringLiteral("User does not have access to this resource.")));
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());

        // Exactly one rediscovery through /me.
        QCOMPARE(f.find("GET", "/me").size(), 2);
        const qsizetype rediscovery = f.last("GET", "/me");
        QVERIFY(f.unanswered(rediscovery));
        f.respond(rediscovery, FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.timer.workspaceAccessLost());

        // Nothing more is sent: no workspace reads, no replay, no second
        // rediscovery. The state is the account's, so the state client goes
        // on reading it.
        const qsizetype requests = f.otherRequests();
        for (int i = 0; i < 95; ++i) {
            f.clock.advance(1000);
        }
        f.timer.resumed();
        f.timer.refresh();
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.otherRequests(), requests);
        QCOMPARE(f.find("POST", "/time_entries").size(), trigger == "start" ? 1 : 0);
        QCOMPARE(f.find("PATCH", "/stop").size(), trigger == "stop" ? 1 : 0);

        // An explicit reconnect lifts the block.
        f.timer.reconnect();
        QVERIFY(!f.timer.workspaceAccessLost());
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        if (f.unanswered(f.last("GET", statePath))) {
            QVERIFY(f.answerState("null"));
        }
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.projects().size(), 1);
    }

    void workspaceLossKeepsTheMutationLock()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        // A start goes out while a projects read is pending.
        f.timer.refresh();
        QVERIFY(f.answerState("null"));
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", "/time_entries");

        // The projects read loses the workspace before the start answers.
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isBusy());
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));

        // Reconnecting to the same account and workspace does not unlock writes.
        f.timer.reconnect();
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        if (f.unanswered(f.last("GET", "/projects"))) {
            f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        }
        QVERIFY(!f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
        // The state read the reconnect sent answers first: nothing changed
        // yet.
        if (f.unanswered(f.last("GET", statePath))) {
            f.respond(f.last("GET", statePath), FakeTransport::answer(200, stateJson(f.revision, f.clock.now(), "null", QJsonValue::Null, QJsonValue::Null)));
        }

        // The start answers: a state read runs before writes return.
        const qsizetype readsBefore = f.find("GET", statePath).size();
        f.respond(post, FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
        QCOMPARE(f.find("GET", statePath).size(), readsBefore + 1);
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        f.respond(read, f.stateAnswer(entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.currentEntry()->id, 40);
        QCOMPARE(f.find("POST", "/time_entries").size(), 1);
    }

    void workspaceRediscoveryMovesToTheNewWorkspace()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(f.timer.workspaceAccessLost());

        // /me names another default workspace: a new context, no replay.
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 8)));
        QVERIFY(!f.timer.workspaceAccessLost());
        QCOMPARE(f.timer.workspaceId(), 8);
        const HttpRequest projects = f.transport.requests.at(f.last("GET", "/projects"));
        QCOMPARE(projects.url.path(), QStringLiteral("/api/v9/workspaces/8/projects"));
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(8)));
        // The entry from the lost workspace is not shown in the new one.
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
    }

    void rediscoveryRefusedClearsTheAccount()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QVERIFY(!f.timer.isConnected());
        QCOMPARE(f.timer.connectionState(), Connection::AuthenticationFailed);
        QVERIFY(!f.timer.canWrite());
        QCOMPARE(f.find("GET", "/me").size(), 2);
    }

    void accountSwitchWithCollidingIds_data()
    {
        QTest::addColumn<bool>("switchInstance");
        QTest::newRow("instance") << true;
        QTest::newRow("account on the same instance") << false;
    }

    void accountSwitchWithCollidingIds()
    {
        QFETCH(bool, switchInstance);
        Fixture f;
        QVERIFY(connectAccount(f));
        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);
        // A stop is in flight when the account changes.
        QVERIFY(f.timer.stop());
        const qsizetype oldStop = f.last("PATCH", "/stop");
        QVERIFY(f.timer.isBusy());

        QSignalSpy entryChanged(&f.timer, &TimerController::currentEntryChanged);
        if (switchInstance) {
            f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
            f.connection.setInstanceUrl(instanceB);
        } else {
            // A new token for the same instance names another account.
            f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), QStringLiteral("tok-other"));
            Q_EMIT f.store.secretChanged(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()));
        }
        // Cleared at once, before the new account answers.
        QVERIFY(entryChanged.count() > 0);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isConnected());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));

        // The new account reuses user 3, workspace 7 and entry 5.
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        const qsizetype newRead = f.last("GET", statePath);
        QVERIFY(f.unanswered(newRead));
        QVERIFY(f.transport.requests.at(newRead).url.host() == (switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test")));

        // The old stop answers late: ignored, even though entry 5 exists again.
        f.respond(oldStop, FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        f.respond(newRead, f.stateAnswer(entryBody(5, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:00"));
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());

        // Stopping now targets the new context only.
        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("PATCH", "/stop")).url.host(),
                 switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test"));
    }

    void indicatorFollowsTheRunningEntry()
    {
        Fixture f;
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);

        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == 1;
        }));
        f.respond(0, FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 11)));
        // The project is not known until the project list answers.
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 1);
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#06aaf5"));
        QCOMPARE(indicator.count(), 2);

        // An entry without a project shows nothing.
        poll(f);
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 3);
    }

    void indicatorResolvesProjectsMissingFromTheList_data()
    {
        QTest::addColumn<bool>("running");
        QTest::newRow("running entry") << true;
        QTest::newRow("next start") << false;
    }

    void indicatorResolvesProjectsMissingFromTheList()
    {
        QFETCH(bool, running);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, running ? entryBody(5, 7, startedAt, true, 33) : QByteArray("null")));
        if (!running) {
            f.timer.setSelectedProjectId(33);
        }
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 33);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        const qsizetype archived = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(archived));

        // Archived: known, with its colour, whatever the case of the digits.
        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);
        f.respond(archived, FakeTransport::answer(200, json(projectObject(33, 7, QStringLiteral("#9E5BD9"), false))));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#9e5bd9"));
        QCOMPARE(indicator.count(), 1);

        // Deleted on the server: 404 gives None.
        if (running) {
            poll(f);
            QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 44)));
        } else {
            f.timer.setSelectedProjectId(44);
        }
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        f.respond(f.last("GET", "/projects/44"), FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 3);
        if (running) {
            // entryProject keeps the id without a name, as before.
            QCOMPARE(f.timer.entryProject()->id, 44);
            QVERIFY(f.timer.entryProject()->name.isEmpty());
        } else {
            QVERIFY(!f.timer.entryProject());
        }
        QCOMPARE(f.find("GET", "/projects/44").size(), 1);
    }

    void lookedUpProjectIsReadAgainOnRefresh_data()
    {
        QTest::addColumn<bool>("running");
        QTest::addColumn<bool>("viaReconnect");
        QTest::newRow("running entry, reconnect") << true << true;
        QTest::newRow("running entry, projects reload") << true << false;
        QTest::newRow("next start, reconnect") << false << true;
        QTest::newRow("next start, projects reload") << false << false;
    }

    void lookedUpProjectIsReadAgainOnRefresh()
    {
        QFETCH(bool, running);
        QFETCH(bool, viaReconnect);
        const QByteArray current = running ? entryBody(5, 7, startedAt, true, 33) : QByteArray("null");
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        if (!running) {
            f.timer.setSelectedProjectId(33);
        }
        f.respond(f.last("GET", "/projects/33"), FakeTransport::answer(200, json(projectObject(33, 7, QStringLiteral("#9e5bd9"), false))));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.find("GET", "/projects/33").size(), 1);

        // Project 33 is deleted on the server, then the projects are refreshed.
        const qsizetype before = f.transport.requests.size();
        if (viaReconnect) {
            f.timer.reconnect();
        } else {
            f.timer.refresh();
        }
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(read >= before);
        f.respond(read, f.stateAnswer(current));
        const qsizetype list = f.last("GET", "/projects");
        QVERIFY(list >= before);
        f.respond(list, FakeTransport::answer(200, projectsBody(7)));
        QCOMPARE(f.find("GET", "/projects/33").size(), 2);
        const qsizetype again = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(again));
        // The known project stays on show while it is read again.
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);

        // Another refresh and a poll while that read is out ask nothing more.
        f.timer.refresh();
        QVERIFY(f.answerState(current));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), 2);

        // That read began before the second reload, so its answer is shown
        // and checked once more.
        f.respond(again, FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(f.find("GET", "/projects/33").size(), 3);
        f.respond(f.last("GET", "/projects/33"), FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), 3);
    }

    void lookupFromBeforeAReloadIsReadAgain_data()
    {
        QTest::addColumn<bool>("cached");
        QTest::newRow("revalidation") << true;
        QTest::newRow("first read") << false;
    }

    void lookupFromBeforeAReloadIsReadAgain()
    {
        QFETCH(bool, cached);
        const QByteArray current = entryBody(5, 7, startedAt, true, 33);
        const QByteArray archived = json(projectObject(33, 7, QStringLiteral("#9e5bd9"), false));
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        qsizetype older = f.last("GET", "/projects/33");
        if (cached) {
            // Known from a first read, then read again after a reload.
            f.respond(older, FakeTransport::answer(200, archived));
            f.timer.refresh();
            QVERIFY(f.answerState(current));
            f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
            older = f.last("GET", "/projects/33");
        }
        QVERIFY(f.unanswered(older));
        const qsizetype reads = f.find("GET", "/projects/33").size();

        // Project 33 is deleted, a reload completes, then the older read
        // answers with the project as it was.
        f.timer.refresh();
        QVERIFY(f.answerState(current));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads);
        f.respond(older, FakeTransport::answer(200, archived));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);

        // One follow-up read, and its 404 gives None.
        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
        const qsizetype followUp = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(followUp));
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
        f.respond(followUp, FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
    }

    void indicatorColorMustBeHex_data()
    {
        QTest::addColumn<QString>("color");
        QTest::newRow("empty") << QString();
        QTest::newRow("short") << QStringLiteral("#abc");
        QTest::newRow("long") << QStringLiteral("#06aaf5ff");
        QTest::newRow("no hash") << QStringLiteral("06aaf5");
        QTest::newRow("name") << QStringLiteral("red");
        QTest::newRow("not hex") << QStringLiteral("#06aaf g");
        QTest::newRow("trailing space") << QStringLiteral("#06aaf5 ");
    }

    void indicatorColorMustBeHex()
    {
        QFETCH(QString, color);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        f.timer.refresh();
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, "[" + json(projectObject(12, 7, color)) + "]"));
        QVERIFY(f.timer.chooseProject(12));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QVERIFY(f.timer.indicatorColor().isEmpty());
    }

    void indicatorChangesAreSignalled()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);

        // A choice.
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(indicator.count(), 1);

        // A start: the running entry's project counts, here none.
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(200, entryBody(21, 7, startedAt)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QCOMPARE(indicator.count(), 2);
        QVERIFY(f.answerState(entryBody(21, 7, startedAt)));
        QCOMPARE(indicator.count(), 2);

        // A stop of an entry on a project: the next start takes it.
        poll(f);
        QVERIFY(f.answerState(entryBody(22, 7, startedAt, true, 11)));
        QCOMPARE(indicator.count(), 3);
        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(22, 7, startedAt, false, 11)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(indicator.count(), 3);
        QVERIFY(f.answerState("null"));

        // A projects reload with a new colour.
        f.timer.refresh();
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, "[" + json(projectObject(11, 7, QStringLiteral("#d92b2b"))) + "]"));
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#d92b2b"));
        QCOMPARE(indicator.count(), 4);

        // A new generation clears it.
        f.connection.setInstanceUrl(instanceB);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 5);
    }

    void incompleteProjectListFollowsTheConnection()
    {
        Fixture f;
        QVERIFY(f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token) != f.store.secrets.end());
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.projectsIncomplete());

        // Every page up to the limit is full and new.
        QSignalSpy changed(&f.timer, &TimerController::projectsChanged);
        for (int page = 1; page <= Connection::maxProjectPages; ++page) {
            const qsizetype request = f.last("GET", "/projects");
            QVERIFY(f.unanswered(request));
            QCOMPARE(f.timer.projects().size(), 0);
            f.respond(request, FakeTransport::answer(200, projectPage((page - 1) * Connection::projectPageSize + 1, Connection::projectPageSize, 7)));
        }
        QVERIFY(f.connection.projectsIncomplete());
        QVERIFY(f.timer.projectsIncomplete());
        // The projects read stay selectable.
        QCOMPARE(f.timer.projects().size(), Connection::maxProjectPages * Connection::projectPageSize);
        QCOMPARE(changed.count(), 1);

        // Another account clears the notice with the projects.
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceB);
        QVERIFY(!f.timer.projectsIncomplete());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(changed.count() > 1);

        // A list that ends on a short page is complete.
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(4, 7)));
        QVERIFY(f.answerState("null"));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 7)));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectPage(1000, 3, 7)));
        QCOMPARE(f.timer.projects().size(), Connection::projectPageSize + 3);
        QVERIFY(!f.timer.projectsIncomplete());
    }

    void entryFromAnotherWorkspaceIsNotShown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 99, startedAt)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.currentEntryVariant().isNull());
    }

    void stateClientCanBeReplaced()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        poll(f);
        const qsizetype poll = f.last("GET", statePath);
        QVERIFY(f.unanswered(poll));

        FakeTransport otherTransport;
        FakeCredentialStore otherStore;
        Connection other(&otherTransport, &otherStore, testClientName());
        TimerStateClient otherState(&other, &f.clock);
        f.timer.setStateClient(&otherState);
        QCOMPARE(f.timer.stateClient(), &otherState);
        QCOMPARE(f.timer.connection(), &other);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isConnected());
        // Replies to the first client no longer reach the controller.
        f.respond(poll, f.stateAnswer(entryBody(5, 7, startedAt)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(otherTransport.requests.isEmpty());

        // A client that goes away takes its connection with it.
        {
            TimerStateClient scoped(&f.connection, &f.clock);
            f.timer.setStateClient(&scoped);
            QCOMPARE(f.timer.connection(), &f.connection);
        }
        QVERIFY(!f.timer.stateClient());
        QVERIFY(!f.timer.connection());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
    }
};

QTEST_GUILESS_MAIN(TimerControllerTest)
#include "timercontrollertest.moc"
