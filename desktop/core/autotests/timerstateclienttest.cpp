// The timer state client, driven through a fake clock, a scripted transport
// with scripted streams and a scripted credential store.

#include "connection.h"
#include "fakes.h"
#include "timerstateclient.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-state-1");
const QString statePath = QStringLiteral("/api/app/timer");
const QString eventsPath = QStringLiteral("/api/app/timer/events");

QByteArray meBody(qint64 id, qint64 workspace)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("default_workspace_id"), workspace},
                         })
        .toJson(QJsonDocument::Compact);
}

// A state with nothing running, built offsetMs after the given time.
QByteArray stateBody(qint64 revision, const QDateTime &clientNow, qint64 offsetMs = 0)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("revision"), revision},
                             {QStringLiteral("server_time"), clientNow.addMSecs(offsetMs).toUTC().toString(Qt::ISODateWithMs)},
                             {QStringLiteral("running_entry"), QJsonValue::Null},
                             {QStringLiteral("pause"), QJsonValue::Null},
                             {QStringLiteral("pomodoro"), QJsonValue::Null},
                             {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
                         })
        .toJson(QJsonDocument::Compact);
}

// One timer event as the server frames it.
QByteArray eventFrame(const QByteArray &state)
{
    return "event: timer\ndata: " + state + "\n\n";
}

HttpResponse cleanEnd()
{
    return FakeTransport::answer(200, QByteArray());
}
}

class TimerStateClientTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        Connection connection{&transport, &store, testClientName()};
        TimerStateClient client{&connection, &clock};
        QSignalSpy changes{&client, &TimerStateClient::stateChanged};
        QSignalSpy streamingChanges{&client, &TimerStateClient::streamingChanged};

        // Requests whose path is exactly the given one, after the instance's
        // own prefix.
        QList<qsizetype> find(const QByteArray &method, const QString &path) const
        {
            QList<qsizetype> found;
            for (qsizetype i = 0; i < transport.requests.size(); ++i) {
                const HttpRequest &request = transport.requests.at(i);
                if (request.method == method && request.url.path().endsWith(path)) {
                    found.append(i);
                }
            }
            return found;
        }

        qsizetype last(const QByteArray &method, const QString &path) const
        {
            const QList<qsizetype> found = find(method, path);
            return found.isEmpty() ? -1 : found.last();
        }

        qsizetype reads() const
        {
            return find("GET", statePath).size();
        }

        void respond(qsizetype index, const HttpResponse &response)
        {
            transport.respond(index, response);
        }

        // Answers the latest read of the state.
        void answerRead(const QByteArray &body)
        {
            respond(last("GET", statePath), FakeTransport::answer(200, body));
        }

        void tick(int seconds = 1)
        {
            for (int i = 0; i < seconds; ++i) {
                clock.advance(1000);
            }
        }

        // Ticks one second at a time until a new stream opens, at most limit
        // seconds. The seconds it took, or -1.
        int secondsToNextStream(int limit = 120)
        {
            const qsizetype before = transport.streams.size();
            for (int second = 1; second <= limit; ++second) {
                tick();
                if (transport.streams.size() > before) {
                    return second;
                }
            }
            return -1;
        }
    };

    // Configure token auth for the instance and answer /me. The client then
    // reads the state and opens the stream.
    static bool connectAccount(Fixture &f, const QString &url = instanceA, qint64 userId = 3)
    {
        f.store.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(url);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.respond(before, FakeTransport::answer(200, meBody(userId, 7)));
        return f.connection.state() == Connection::Connected;
    }

    // Connected, with the state read at the given revision and the stream
    // delivering it.
    static bool streamAt(Fixture &f, qint64 revision)
    {
        if (!connectAccount(f) || f.last("GET", statePath) < 0 || !f.transport.lastStream()) {
            return false;
        }
        f.answerRead(stateBody(revision, f.clock.now()));
        f.transport.lastStream()->push(eventFrame(stateBody(revision, f.clock.now())));
        return f.client.streaming() && f.client.state() && f.client.state()->revision == revision;
    }

private Q_SLOTS:
    // A new context reads the state and opens the stream with the same
    // credentials. Events may arrive in any number of pieces.
    void readsThenStreams()
    {
        Fixture f;
        QVERIFY(!f.client.state());
        QVERIFY(connectAccount(f));

        const qsizetype read = f.last("GET", statePath);
        QVERIFY(read >= 0);
        QCOMPARE(f.transport.requests.at(read).url.toString(), QStringLiteral("https://a.example.test/api/app/timer"));
        QCOMPARE(f.transport.streamRequests.size(), 1);
        const HttpRequest &open = f.transport.streamRequests.first();
        QCOMPARE(open.method, QByteArray("GET"));
        QCOMPARE(open.url.toString(), QStringLiteral("https://a.example.test/api/app/timer/events"));
        QCOMPARE(open.authorization, f.transport.requests.first().authorization);
        QVERIFY(!open.authorization.isEmpty());
        QVERIFY(!f.client.streaming());

        // The server's clock runs 2.5 s ahead.
        f.answerRead(stateBody(3, f.clock.now(), 2500));
        QCOMPARE(f.changes.size(), 1);
        QCOMPARE(f.client.state()->revision, 3);
        QCOMPARE(f.client.serverOffsetMs(), 2500);
        QCOMPARE(f.client.serverNow(), f.clock.now().addMSecs(2500));
        QVERIFY(!f.client.streaming());

        // An event split across two pieces, the cut inside the JSON.
        FakeStream *stream = f.transport.lastStream();
        const QByteArray event = eventFrame(stateBody(4, f.clock.now(), -1000));
        stream->push(event.left(30));
        QCOMPARE(f.changes.size(), 1);
        QVERIFY(!f.client.streaming());
        stream->push(event.mid(30));
        QCOMPARE(f.changes.size(), 2);
        QCOMPARE(f.client.state()->revision, 4);
        QCOMPARE(f.client.serverOffsetMs(), -1000);
        QVERIFY(f.client.streaming());
        QCOMPARE(f.streamingChanges.size(), 1);

        // Keep-alive comments, other events and an unreadable state change
        // nothing.
        stream->push(": keep-alive\n\n");
        stream->push("event: other\ndata: " + stateBody(9, f.clock.now()) + "\n\n");
        stream->push("event: timer\ndata: {\"revision\":9}\n\n");
        stream->push("data: " + stateBody(9, f.clock.now()) + "\n\n");
        QCOMPARE(f.changes.size(), 2);
        QCOMPARE(f.client.state()->revision, 4);

        // An older revision is ignored; the same one is taken again. CRLF
        // line ends and data split over two lines are accepted.
        stream->push(eventFrame(stateBody(2, f.clock.now())));
        QCOMPARE(f.changes.size(), 2);
        QCOMPARE(f.client.serverOffsetMs(), -1000);
        QByteArray same = stateBody(4, f.clock.now(), 750);
        same.replace(",", ",\r\ndata:");
        stream->push("event:timer\r\ndata: " + same + "\r\n\r\n");
        QCOMPARE(f.changes.size(), 3);
        QCOMPARE(f.client.serverOffsetMs(), 750);

        // No polling while the stream is up.
        const qsizetype reads = f.reads();
        f.tick(65);
        QCOMPARE(f.reads(), reads);
        QCOMPARE(f.transport.streams.size(), 1);
        QVERIFY(!stream->aborted);
    }

    // When the stream ends the client reads the state, reconnects after a
    // second, and polls every 30 s until a stream delivers again.
    void closeFallsBackToPoll()
    {
        Fixture f;
        QVERIFY(streamAt(f, 5));
        const qsizetype reads = f.reads();

        f.transport.lastStream()->end(cleanEnd());
        QVERIFY(!f.client.streaming());
        QCOMPARE(f.streamingChanges.size(), 2);
        QCOMPARE(f.reads(), reads + 1);
        f.answerRead(stateBody(6, f.clock.now()));
        QCOMPARE(f.client.state()->revision, 6);

        QCOMPARE(f.secondsToNextStream(), 1);
        FakeStream *reconnect = f.transport.lastStream();
        QCOMPARE(f.transport.streamRequests.last().url.path(), eventsPath);

        // It opens, but sends nothing: the state is still polled.
        f.tick(28);
        QCOMPARE(f.reads(), reads + 1);
        f.tick();
        QCOMPARE(f.reads(), reads + 2);
        f.answerRead(stateBody(7, f.clock.now()));
        QCOMPARE(f.client.state()->revision, 7);
        f.tick(30);
        QCOMPARE(f.reads(), reads + 3);
        f.answerRead(stateBody(7, f.clock.now()));

        reconnect->push(eventFrame(stateBody(8, f.clock.now())));
        QVERIFY(f.client.streaming());
        QCOMPARE(f.client.state()->revision, 8);
        f.tick(90);
        QCOMPARE(f.reads(), reads + 3);
        QCOMPARE(f.transport.streams.size(), 2);

        // A wake reads at once and replaces the stream, which may have died
        // in the sleep.
        f.client.resumed();
        QCOMPARE(f.reads(), reads + 4);
        QVERIFY(reconnect->aborted);
        QCOMPARE(f.transport.streams.size(), 3);
        QVERIFY(!f.client.streaming());
        // So does a tick that comes late.
        f.answerRead(stateBody(8, f.clock.now()));
        f.clock.advance(2 * 3600 * 1000);
        QCOMPARE(f.reads(), reads + 5);
        QCOMPARE(f.transport.streams.size(), 4);
    }

    // Each failed connect doubles the wait, from 1 s up to 60 s. A stream
    // that stayed up for 60 s starts again from 1 s.
    void reconnectBacksOff()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.answerRead(stateBody(1, f.clock.now()));

        const QList<int> waits{1, 2, 4, 8, 16, 32, 60, 60};
        for (int wait : waits) {
            f.transport.lastStream()->end(FakeTransport::answer(503, "\"Service Unavailable\""));
            QCOMPARE(f.secondsToNextStream(), wait);
        }

        // A stream that delivered but did not last does not reset the wait.
        f.transport.lastStream()->push(eventFrame(stateBody(1, f.clock.now())));
        QVERIFY(f.client.streaming());
        f.tick(10);
        f.transport.lastStream()->end(cleanEnd());
        QCOMPARE(f.secondsToNextStream(), 60);

        f.transport.lastStream()->push(eventFrame(stateBody(1, f.clock.now())));
        f.tick(60);
        f.transport.lastStream()->end(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QCOMPARE(f.secondsToNextStream(), 1);
        f.transport.lastStream()->end(FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QCOMPARE(f.secondsToNextStream(), 2);

        // A stream that never ends its event is dropped like a failed one.
        FakeStream *endless = f.transport.lastStream();
        endless->push("data: " + QByteArray(TimerStateClient::maxEventBytes, 'x'));
        QVERIFY(endless->aborted);
        QCOMPARE(f.secondsToNextStream(), 4);

        // A 429 starts the connection's cooldown, as for any request.
        f.transport.lastStream()->end(FakeTransport::answer(429, "\"Too many requests\"", "120"));
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        QVERIFY(f.client.state());
    }

    // A new generation drops the state, its revision and the stream. A
    // refused stream signs the account out like any refused credential.
    void generationDropsState()
    {
        Fixture f;
        QVERIFY(streamAt(f, 9));
        FakeStream *old = f.transport.lastStream();
        old->push(eventFrame(stateBody(9, f.clock.now(), 4000)));
        QCOMPARE(f.client.serverOffsetMs(), 4000);
        const qsizetype oldRead = f.last("GET", statePath);
        f.client.refresh();
        QCOMPARE(f.last("GET", statePath), oldRead + 1);
        const qsizetype pendingRead = f.last("GET", statePath);
        const int changes = int(f.changes.size());

        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceB);
        QVERIFY(!f.client.state());
        QVERIFY(!f.client.streaming());
        QCOMPARE(f.client.serverOffsetMs(), 0);
        QCOMPARE(f.changes.size(), changes + 1);
        QVERIFY(old->aborted);

        // Late answers from the old account are dropped.
        old->push(eventFrame(stateBody(10, f.clock.now())));
        f.respond(pendingRead, FakeTransport::answer(200, stateBody(10, f.clock.now())));
        QVERIFY(!f.client.state());

        QTRY_COMPARE(f.transport.requests.last().url.path(), QStringLiteral("/tokkl/api/v9/me"));
        f.respond(f.transport.requests.size() - 1, FakeTransport::answer(200, meBody(4, 8)));
        QCOMPARE(f.transport.requests.last().url.toString(), QStringLiteral("https://b.example.test/tokkl/api/app/timer"));
        QCOMPARE(f.transport.streamRequests.last().url.toString(), QStringLiteral("https://b.example.test/tokkl/api/app/timer/events"));
        // The other account's revision 1 is newer than nothing.
        f.answerRead(stateBody(1, f.clock.now()));
        QCOMPARE(f.client.state()->revision, 1);

        // The credential stops passing when the stream reconnects.
        f.transport.lastStream()->end(cleanEnd());
        QCOMPARE(f.secondsToNextStream(), 1);
        f.transport.lastStream()->end(FakeTransport::answer(403, "\"Invalid credentials\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(!f.client.state());
        const qsizetype requests = f.transport.requests.size();
        QCOMPARE(f.secondsToNextStream(90), -1);
        QCOMPARE(f.transport.requests.size(), requests);
    }

    // The read after an end finds the account signed out.
    void signedOutAfterEnd()
    {
        Fixture f;
        QVERIFY(streamAt(f, 2));
        f.transport.lastStream()->end(cleanEnd());
        f.respond(f.last("GET", statePath), FakeTransport::answer(403, "\"Invalid credentials\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(!f.client.state());
        const qsizetype streams = f.transport.streams.size();
        f.tick(90);
        QCOMPARE(f.transport.streams.size(), streams);
    }

    // Each action posts to its route and takes the state it gets back, on
    // success and on a 409. An unknown outcome is settled by a read, never
    // by sending again.
    void actionsAdoptState()
    {
        Fixture f;
        QList<TimerActionResult> results;
        const auto record = [&results](const TimerActionResult &result) {
            results.append(result);
        };

        // Without a state there is no revision to send.
        QVERIFY(connectAccount(f));
        const qsizetype sent = f.transport.requests.size();
        f.client.resume(record);
        QTRY_COMPARE(results.size(), 1);
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Refused);
        QCOMPARE(f.transport.requests.size(), sent);
        f.answerRead(stateBody(5, f.clock.now()));
        f.transport.lastStream()->push(eventFrame(stateBody(5, f.clock.now())));

        f.client.pause(record);
        qsizetype post = f.last("POST", QStringLiteral("/api/app/timer/pause"));
        QVERIFY(post >= 0);
        QCOMPARE(f.transport.requests.at(post).body, QByteArray("{}"));
        f.respond(post, FakeTransport::answer(200, stateBody(6, f.clock.now(), 300)));
        QCOMPARE(results.size(), 2);
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Applied);
        QCOMPARE(results.last().state->revision, 6);
        QCOMPARE(f.client.state()->revision, 6);
        QCOMPARE(f.client.serverOffsetMs(), 300);

        // Another device changed the timer first.
        f.client.resume(record);
        post = f.last("POST", QStringLiteral("/api/app/timer/resume"));
        QCOMPARE(f.transport.requests.at(post).body, QByteArray(R"({"revision":6})"));
        f.respond(post, FakeTransport::answer(409, stateBody(8, f.clock.now())));
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Conflict);
        QCOMPARE(results.last().state->revision, 8);
        QCOMPARE(results.last().error.status, 409);
        QCOMPARE(f.client.state()->revision, 8);

        // A 409 without a state still says nothing changed.
        f.client.discard(record);
        post = f.last("POST", QStringLiteral("/api/app/timer/discard"));
        QCOMPARE(f.transport.requests.at(post).body, QByteArray(R"({"revision":8})"));
        f.respond(post, FakeTransport::answer(409, "\"The timer changed\""));
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Refused);
        QCOMPARE(f.client.state()->revision, 8);

        // An answer older than the state already held does not replace it.
        f.transport.lastStream()->push(eventFrame(stateBody(10, f.clock.now())));
        PomodoroStart start;
        start.projectId = 11;
        f.client.startPomodoro(start, record);
        post = f.last("POST", QStringLiteral("/api/app/pomodoro"));
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(post).body).object();
        QCOMPARE(body.value(QLatin1String("workspace_id")).toInteger(), 7);
        QCOMPARE(body.value(QLatin1String("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QLatin1String("created_with")).toString(), testClientName());
        f.respond(post, FakeTransport::answer(201, stateBody(9, f.clock.now())));
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Applied);
        QCOMPARE(f.client.state()->revision, 10);

        // Unknown outcomes: a timeout, a 5xx, an unreadable answer.
        const struct {
            void (TimerStateClient::*send)(TimerStateClient::ActionCallback);
            QString path;
            HttpResponse answer;
        } unknowns[] = {
            {&TimerStateClient::nextPhase, QStringLiteral("/api/app/pomodoro/next"), FakeTransport::failure(HttpResponse::Outcome::Timeout)},
            {&TimerStateClient::endPomodoro, QStringLiteral("/api/app/pomodoro/end"), FakeTransport::answer(502, "<html>")},
            {&TimerStateClient::nextPhase, QStringLiteral("/api/app/pomodoro/next"), FakeTransport::answer(200, "{\"revision\":11}")},
        };
        for (const auto &unknown : unknowns) {
            const qsizetype reads = f.reads();
            (f.client.*unknown.send)(record);
            post = f.last("POST", unknown.path);
            QCOMPARE(f.transport.requests.at(post).body, QByteArray(R"({"revision":10})"));
            f.respond(post, unknown.answer);
            QVERIFY(results.last().outcome == TimerActionResult::Outcome::Unknown);
            QVERIFY(!results.last().state);
            QCOMPARE(f.find("POST", unknown.path).last(), post);
            QCOMPARE(f.reads(), reads + 1);
            f.answerRead(stateBody(10, f.clock.now()));
        }

        // Any other refusal changed nothing.
        f.client.endPomodoro(record);
        f.respond(f.last("POST", QStringLiteral("/api/app/pomodoro/end")), FakeTransport::answer(400, "\"Invalid revision\""));
        QVERIFY(results.last().outcome == TimerActionResult::Outcome::Refused);
        QCOMPARE(results.last().error.status, 400);
        QCOMPARE(f.client.state()->revision, 10);
    }
};

QTEST_GUILESS_MAIN(TimerStateClientTest)

#include "timerstateclienttest.moc"
