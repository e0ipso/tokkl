// The timer controller, driven through a fake clock, a scripted transport and
// a scripted credential store.

#include "connection.h"
#include "fakes.h"
#include "timercontroller.h"

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
const QByteArray currentPath = "/me/time_entries/current";

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

QByteArray entryBody(qint64 id, qint64 workspace, const QString &start, bool running = true)
{
    const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("workspace_id"), workspace},
                             {QStringLiteral("project_id"), QJsonValue::Null},
                             {QStringLiteral("billable"), false},
                             {QStringLiteral("start"), start},
                             {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(begin.addSecs(60).toString(Qt::ISODate))},
                             {QStringLiteral("duration"), running ? -begin.toSecsSinceEpoch() : 60},
                             {QStringLiteral("description"), QString()},
                             {QStringLiteral("tags"), QJsonArray()},
                         })
        .toJson(QJsonDocument::Compact);
}

QByteArray projectsBody(qint64 workspace)
{
    return QStringLiteral(R"([{"id":11,"workspace_id":%1,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])")
        .arg(workspace)
        .toUtf8();
}

const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z"); // 65 s before the fake clock
}

class TimerControllerTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        Connection connection{&transport, &store};
        TimerController timer{&clock};

        Fixture()
        {
            timer.setConnection(&connection);
        }

        // Requests whose API path (after /api/v9) ends with the given text.
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

        QSet<qsizetype> answered;
    };

    // Configure token auth for the instance, answer /me, then the reads the
    // controller sends for the new context.
    static bool connectAccount(Fixture &f,
                               const QString &url = instanceA,
                               qint64 userId = 3,
                               qint64 workspace = 7,
                               const QByteArray &current = entryBody(5, 7, startedAt))
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
        const qsizetype entry = f.last("GET", currentPath);
        const qsizetype projects = f.last("GET", "/projects");
        if (!f.unanswered(entry) || !f.unanswered(projects)) {
            return false;
        }
        f.respond(entry, FakeTransport::answer(200, current));
        f.respond(projects, FakeTransport::answer(200, projectsBody(workspace)));
        return f.timer.isConnected();
    }

private Q_SLOTS:
    void exposesContextAndEntry()
    {
        Fixture f;
        QVERIFY(!f.timer.isConnected());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));
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
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01:05"));

        f.timer.setSelectedProjectId(11);
        f.timer.setBillable(true);
        QCOMPARE(f.connection.nextProjectId(), std::optional<qint64>(11));
        QVERIFY(f.connection.nextBillable());
        QCOMPARE(f.timer.selectedProjectId().toLongLong(), 11);
    }

    void formatsElapsed()
    {
        QCOMPARE(TimerController::formatElapsed(-5), QStringLiteral("0:00:00"));
        QCOMPARE(TimerController::formatElapsed(59), QStringLiteral("0:00:59"));
        QCOMPARE(TimerController::formatElapsed(3600 + 61), QStringLiteral("1:01:01"));
        QCOMPARE(TimerController::formatElapsed(125 * 3600), QStringLiteral("125:00:00"));
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
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01:30"));

        // A clock before the start (skew) never shows negative time.
        f.clock.current = start.addSecs(-30);
        f.clock.advance(0);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));
    }

    void sleepGapKeepsTimeAndRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.clock.advance(1000);
        const qsizetype requests = f.transport.requests.size();

        // Two hours asleep: the next tick arrives late.
        f.clock.advance(2 * 3600 * 1000);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("2:01:06"));
        // Resume reads the entry and the projects at once.
        QCOMPARE(f.transport.requests.size(), requests + 2);
        QVERIFY(f.unanswered(f.last("GET", currentPath)));
        QVERIFY(f.unanswered(f.last("GET", "/projects")));

        // The web app stopped the timer meanwhile.
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, "null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));

        // The explicit hook does the same.
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        f.timer.resumed();
        QVERIFY(f.unanswered(f.last("GET", currentPath)));
    }

    void pollsEveryThirtySeconds()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(!f.timer.isRunning());
        const qsizetype reads = f.find("GET", currentPath).size();

        for (int i = 0; i < 29; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", currentPath).size(), reads);
        f.clock.advance(1000);
        QCOMPARE(f.find("GET", currentPath).size(), reads + 1);

        // A timer started in the web app appears.
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(9, 7, QStringLiteral("2026-10-16T09:00:10Z"))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 9);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:20"));

        // Ticks while a read is outstanding do not stack requests.
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", currentPath).size(), reads + 2);
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", currentPath).size(), reads + 2);

        // Edited in the web app: the panel shows the new start.
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(9, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:01:30"));

        // A clock set far back counts as a resume and reads at once.
        f.clock.current = f.clock.current.addSecs(-20);
        f.clock.advance(0);
        QCOMPARE(f.find("GET", currentPath).size(), reads + 3);
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
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-kde"));
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
        QVERIFY(f.unanswered(f.last("GET", currentPath)));
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"))));

        QVERIFY(f.timer.stop());
        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"), false)));
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, "null"));
        f.timer.setSelectedProjectId(QVariant::fromValue(nullptr));
        f.timer.setBillable(false);
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
        QVERIFY(f.timer.toggle());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("PATCH", "/stop").size(), 1);
        const HttpRequest request = f.transport.requests.at(f.last("PATCH", "/stop"));
        QCOMPARE(request.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5/stop"));
        QVERIFY(request.body.isEmpty());

        f.respond(f.last("PATCH", "/stop"), FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));
        QVERIFY(f.unanswered(f.last("GET", currentPath)));
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
        const qsizetype read = f.last("GET", currentPath);
        QVERIFY(f.unanswered(read));

        f.respond(read, FakeTransport::answer(200, "null"));
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
        qsizetype read = f.last("GET", currentPath);
        QVERIFY(f.unanswered(read));

        // The reconciling read fails too: still busy, nothing replayed.
        f.respond(read, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Network unreachable")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(f.timer.isStale());
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        read = f.last("GET", currentPath);
        QVERIFY(f.unanswered(read));
        f.respond(read, FakeTransport::answer(200, serverStarted ? entryBody(30, 7, QStringLiteral("2026-10-16T09:00:00Z")) : QByteArray("null")));

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
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        const qsizetype stalePoll = f.last("GET", currentPath);
        QVERIFY(f.unanswered(stalePoll));
        QVERIFY(f.timer.start());
        // No poll runs while the mutation does.
        for (int i = 0; i < 31; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.last("GET", currentPath), stalePoll);

        f.respond(f.last("POST", "/time_entries"), FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:01:01Z"))));
        const qsizetype fresh = f.last("GET", currentPath);
        QVERIFY(fresh != stalePoll);
        f.respond(fresh, FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:01:01Z"))));
        QCOMPARE(f.timer.currentEntry()->id, 40);

        // The poll from before the start answers last, with no entry.
        f.respond(stalePoll, FakeTransport::answer(200, "null"));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 40);
    }

    void transientFailureKeepsStaleDataAndRecovers()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", currentPath), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
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
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, "null"));
        QVERIFY(!f.timer.isStale());
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.errorString().isEmpty());
        // Our own read brought the connection back; it is not read twice,
        // and the reconnection reads the projects.
        QCOMPARE(f.find("GET", "/projects").size(), projectsBefore + 1);
        QVERIFY(!f.unanswered(f.last("GET", currentPath)));
    }

    void reconnectionRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", currentPath), FakeTransport::answer(503, "\"Unavailable\""));
        QCOMPARE(f.timer.connectionState(), Connection::Disconnected);
        const qsizetype reads = f.find("GET", currentPath).size();

        f.connection.refreshAccount();
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QCOMPARE(f.find("GET", currentPath).size(), reads + 1);
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(6, 7, startedAt)));
        QCOMPARE(f.timer.currentEntry()->id, 6);
    }

    void authenticationFailureClears_data()
    {
        QTest::addColumn<int>("status");
        QTest::newRow("401") << 401;
        QTest::newRow("403 on the current entry") << 403;
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
        f.respond(f.last("GET", currentPath), FakeTransport::answer(status, "\"Incorrect username and/or password\""));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.isStale());
        QVERIFY(!f.timer.canWrite());
        QCOMPARE(f.timer.connectionState(), Connection::AuthenticationFailed);
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));

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
        f.respond(f.last("GET", currentPath), FakeTransport::answer(429, "\"Too many requests\"", "1"));
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
        QVERIFY(f.unanswered(f.last("GET", currentPath)));
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
            f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(5, 7, startedAt)));
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

        // Nothing more is sent: no polls, no replay, no second rediscovery.
        const qsizetype requests = f.transport.requests.size();
        for (int i = 0; i < 95; ++i) {
            f.clock.advance(1000);
        }
        f.timer.resumed();
        f.timer.refresh();
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.find("POST", "/time_entries").size(), trigger == "start" ? 1 : 0);
        QCOMPARE(f.find("PATCH", "/stop").size(), trigger == "stop" ? 1 : 0);

        // An explicit reconnect lifts the block.
        f.timer.reconnect();
        QVERIFY(!f.timer.workspaceAccessLost());
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, "null"));
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
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, "null"));
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

        // The start answers: a current-entry read runs before writes return.
        const qsizetype readsBefore = f.find("GET", currentPath).size();
        f.respond(post, FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
        QCOMPARE(f.find("GET", currentPath).size(), readsBefore + 1);
        const qsizetype read = f.last("GET", currentPath);
        QVERIFY(f.unanswered(read));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        f.respond(read, FakeTransport::answer(200, entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
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
        f.respond(f.last("GET", currentPath), FakeTransport::answer(200, entryBody(5, 7, startedAt)));
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
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00:00"));

        // The new account reuses user 3, workspace 7 and entry 5.
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        const qsizetype newRead = f.last("GET", currentPath);
        QVERIFY(f.unanswered(newRead));
        QVERIFY(f.transport.requests.at(newRead).url.host() == (switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test")));

        // The old stop answers late: ignored, even though entry 5 exists again.
        f.respond(oldStop, FakeTransport::answer(200, entryBody(5, 7, startedAt, false)));
        f.respond(newRead, FakeTransport::answer(200, entryBody(5, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:00:00"));
        QVERIFY(f.timer.selectedProjectId().isNull());
        QVERIFY(!f.timer.billable());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());

        // Stopping now targets the new context only.
        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("PATCH", "/stop")).url.host(),
                 switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test"));
    }

    void entryFromAnotherWorkspaceIsNotShown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 99, startedAt)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.currentEntryVariant().isNull());
    }

    void connectionCanBeReplaced()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        const qsizetype poll = f.last("GET", currentPath);
        QVERIFY(f.unanswered(poll));

        FakeTransport otherTransport;
        FakeCredentialStore otherStore;
        Connection other(&otherTransport, &otherStore);
        f.timer.setConnection(&other);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isConnected());
        // Replies to the first connection no longer reach the controller.
        f.respond(poll, FakeTransport::answer(200, entryBody(5, 7, startedAt)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(otherTransport.requests.isEmpty());
        f.timer.setConnection(nullptr);
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
    }
};

QTEST_GUILESS_MAIN(TimerControllerTest)
#include "timercontrollertest.moc"
