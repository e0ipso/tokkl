// The save queue for ended pomodoros, driven through the scripted transport
// and clock, with its items in a QSettings file whose writes are logged
// against the transport's requests.

#include "connection.h"
#include "fakes.h"
#include "pomodoroqueue.h"
#include "pomodororecord.h"
#include "pomodorostore.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>
#include <QUrlQuery>

#include <memory>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-queue-1");
const QString entriesPath = QStringLiteral("/api/v9/me/time_entries");
const QString postPath = QStringLiteral("/api/v9/workspaces/7/time_entries");
const QDateTime start(QDate(2026, 10, 16), QTime(8, 30), QTimeZone::UTC);
const QDateTime stop(QDate(2026, 10, 16), QTime(8, 55), QTimeZone::UTC);

QByteArray meBody(qint64 id, qint64 workspace)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), QStringLiteral("UTC")},
                             {QStringLiteral("default_workspace_id"), workspace},
                         })
        .toJson(QJsonDocument::Compact);
}

// A stopped entry as the server lists it.
QJsonObject entryJson(qint64 id, const QDateTime &start, const QDateTime &stop)
{
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("start"), start.toString(Qt::ISODate)},
        {QStringLiteral("stop"), stop.toString(Qt::ISODate)},
        {QStringLiteral("duration"), start.secsTo(stop)},
        {QStringLiteral("description"), QString()},
    };
}

QByteArray entryBody(qint64 id, const QDateTime &start, const QDateTime &stop)
{
    return QJsonDocument(entryJson(id, start, stop)).toJson(QJsonDocument::Compact);
}

QByteArray listBody(const QList<QJsonObject> &entries)
{
    QJsonArray array;
    for (const QJsonObject &entry : entries) {
        array.append(entry);
    }
    return QJsonDocument(array).toJson(QJsonDocument::Compact);
}

// An error body: the API sends the message as a bare JSON string.
QByteArray message(const char *text)
{
    return QByteArrayLiteral("\"") + QByteArray(text) + QByteArrayLiteral("\"");
}

UnsavedPomodoro item(const QString &id, const QString &owner, const QDateTime &start, const QDateTime &stop, const QDateTime &retryAt)
{
    UnsavedPomodoro item;
    item.id = id;
    item.owner = owner;
    item.workspaceId = 7;
    item.start = start;
    item.stop = stop;
    item.duration = start.secsTo(stop);
    item.projectId = 4;
    item.billable = true;
    item.retryAt = retryAt;
    return item;
}

PomodoroSessionRecord session(const QDateTime &at)
{
    PomodoroSessionRecord session;
    session.id = QStringLiteral("s1");
    session.phase = SessionPhase{PhaseKind::Work, at, 1};
    session.pomodoroStart = at;
    return session;
}

// Logs each write with the number of requests the transport had seen by
// then, so a test can show that a write came before a request.
class LoggingStore : public SettingsPomodoroStore
{
    Q_OBJECT

public:
    LoggingStore(QSettings *settings, const FakeTransport *transport)
        : SettingsPomodoroStore(settings)
        , m_transport(transport)
    {
    }

    bool saveRecord(const QString &owner, const QByteArray &json) override
    {
        writes.append({m_transport->requests.size(), owner, PomodoroRecord::fromJson(json)});
        if (refuse) {
            return false;
        }
        return SettingsPomodoroStore::saveRecord(owner, json);
    }

    struct Write {
        qsizetype requestsBefore;
        QString owner;
        PomodoroRecord record;
    };
    QList<Write> writes;
    bool refuse = false;

private:
    const FakeTransport *m_transport;
};
}

class PomodoroQueueTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        FakeTransport transport;
        LoggingStore store{&settings, &transport};
        FakeCredentialStore credentials;
        FakeClock clock;
        Connection connection{&transport, &credentials, testClientName()};
        // Absent for a test that builds its own queue, as there is one per
        // device.
        std::unique_ptr<PomodoroQueue> queue;

        explicit Fixture(bool withQueue = true)
        {
            if (withQueue) {
                queue = std::make_unique<PomodoroQueue>(&connection, &clock, &store);
            }
        }

        QList<UnsavedPomodoro> stored(const QString &owner)
        {
            return PomodoroRecord::fromJson(store.loadRecord(owner)).unsaved;
        }

        const HttpRequest &request(qsizetype index) const
        {
            return transport.requests.at(index);
        }

        bool is(qsizetype index, const QByteArray &method, const QString &path) const
        {
            const HttpRequest &request = transport.requests.at(index);
            return request.method == method && request.url.path() == path;
        }

        QJsonObject body(qsizetype index) const
        {
            return QJsonDocument::fromJson(transport.requests.at(index).body).object();
        }
    };

    // Configure token auth for the instance. Leaves the /me it sends
    // unanswered.
    static bool configure(Fixture &f, const QString &url)
    {
        f.credentials.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(url);
        return QTest::qWaitFor([&] {
            return f.transport.requests.size() == before + 1;
        });
    }

    static bool connectAccount(Fixture &f, const QString &url = instanceA, qint64 userId = 3, qint64 workspace = 7)
    {
        if (!configure(f, url)) {
            return false;
        }
        f.transport.respondLast(FakeTransport::answer(200, meBody(userId, workspace)));
        return f.connection.state() == Connection::Connected;
    }

private Q_SLOTS:
    void writesBeforePostingAndPostsOneAtATime()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const QString owner = f.connection.owner();
        const QDateTime now = f.clock.now();
        const qsizetype before = f.transport.requests.size();

        // The session change and the new item share one write, and the
        // attempt is written before the POST goes out.
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p1"), owner, start, stop, now), session(now)));
        QCOMPARE(f.store.writes.size(), 2);
        QCOMPARE(f.store.writes.at(0).requestsBefore, before);
        QCOMPARE(f.store.writes.at(0).owner, owner);
        QCOMPARE(f.store.writes.at(0).record.session, session(now));
        QCOMPARE(f.store.writes.at(0).record.unsaved, QList<UnsavedPomodoro>{item(QStringLiteral("p1"), owner, start, stop, now)});
        QCOMPARE(f.store.writes.at(1).requestsBefore, before);
        UnsavedPomodoro attempted = item(QStringLiteral("p1"), owner, start, stop, now.addSecs(5));
        attempted.attempts = 1;
        QCOMPARE(f.store.writes.at(1).record.unsaved, QList<UnsavedPomodoro>{attempted});
        QCOMPARE(f.store.writes.at(1).record.session, session(now));

        QCOMPARE(f.transport.requests.size(), before + 1);
        QVERIFY(f.is(before, "POST", postPath));
        const QJsonObject body = f.body(before);
        QCOMPARE(body.value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T08:30:00Z"));
        QCOMPARE(body.value(QLatin1String("stop")).toString(), QStringLiteral("2026-10-16T08:55:00Z"));
        QCOMPARE(body.value(QLatin1String("duration")).toInteger(), 1500);
        QCOMPARE(body.value(QLatin1String("project_id")).toInteger(), 4);
        QCOMPARE(body.value(QLatin1String("billable")).toBool(), true);
        QCOMPARE(body.value(QLatin1String("description")).toString(), QString());
        QVERIFY(body.value(QLatin1String("tags")).isArray());
        QVERIFY(body.value(QLatin1String("tags")).toArray().isEmpty());
        QCOMPARE(body.value(QLatin1String("workspace_id")).toInteger(), 7);
        QCOMPARE(body.value(QLatin1String("created_with")).toString(), testClientName());

        // A second item waits for the first reply. Without a project it
        // posts a null project id.
        UnsavedPomodoro second = item(QStringLiteral("p2"), owner, stop, stop.addSecs(1500), now);
        second.projectId.reset();
        second.billable = false;
        QVERIFY(f.queue->enqueue(second, session(now)));
        QCOMPARE(f.transport.requests.size(), before + 1);
        f.clock.advance(1000);
        QCOMPARE(f.transport.requests.size(), before + 1);

        // A 2xx removes the item and the next one goes out.
        f.transport.respond(before, FakeTransport::answer(200, entryBody(100, start, stop)));
        QCOMPARE(f.transport.requests.size(), before + 2);
        QVERIFY(f.is(before + 1, "POST", postPath));
        QVERIFY(f.body(before + 1).value(QLatin1String("project_id")).isNull());
        QCOMPARE(f.body(before + 1).value(QLatin1String("billable")).toBool(), false);
        QCOMPARE(f.stored(owner).size(), 1);
        QCOMPARE(f.stored(owner).first().id, QStringLiteral("p2"));
        QCOMPARE(f.stored(owner).first().attempts, 1);
        f.transport.respond(before + 1, FakeTransport::answer(200, entryBody(101, stop, stop.addSecs(1500))));
        QVERIFY(f.stored(owner).isEmpty());
        QCOMPARE(PomodoroRecord::fromJson(f.store.loadRecord(owner)).session, session(now));
        QVERIFY(f.queue->message().isEmpty());

        // A write the store refuses queues nothing and posts nothing.
        f.store.refuse = true;
        QVERIFY(!f.queue->enqueue(item(QStringLiteral("p3"), owner, start, stop, now), session(now)));
        QCOMPARE(f.transport.requests.size(), before + 2);
        f.store.refuse = false;
        QVERIFY(f.stored(owner).isEmpty());

        // An item without an owner or workspace is refused before any write.
        const qsizetype writes = f.store.writes.size();
        QVERIFY(!f.queue->enqueue(item(QStringLiteral("p4"), QString(), start, stop, now), session(now)));
        UnsavedPomodoro noWorkspace = item(QStringLiteral("p5"), owner, start, stop, now);
        noWorkspace.workspaceId = 0;
        QVERIFY(!f.queue->enqueue(noWorkspace, session(now)));
        QCOMPARE(f.store.writes.size(), writes);
    }

    void backsOffAndLooksUpBeforeARetry()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const QString owner = f.connection.owner();
        const QDateTime now = f.clock.now();
        const qsizetype post = f.transport.requests.size();
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p1"), owner, start, stop, now), std::nullopt));
        QVERIFY(f.is(post, "POST", postPath));

        // A 5xx keeps the item, which is due in 5 s. Until then ticks send
        // nothing.
        f.transport.respond(post, FakeTransport::answer(503, QByteArray()));
        QCOMPARE(f.stored(owner).size(), 1);
        QCOMPARE(f.stored(owner).first().attempts, 1);
        QCOMPARE(f.stored(owner).first().retryAt, now.addSecs(5));
        for (int i = 0; i < 4; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.transport.requests.size(), post + 1);

        // The retry counts its attempt, then reads the entries of the span
        // before posting again.
        f.clock.advance(1000);
        QCOMPARE(f.transport.requests.size(), post + 2);
        QCOMPARE(f.stored(owner).first().attempts, 2);
        QCOMPARE(f.stored(owner).first().retryAt, f.clock.now().addSecs(10));
        QCOMPARE(f.store.writes.last().requestsBefore, post + 1);
        QVERIFY(f.is(post + 1, "GET", entriesPath));
        const QUrlQuery query(f.request(post + 1).url);
        QCOMPARE(query.queryItemValue(QStringLiteral("start_date"), QUrl::FullyDecoded), QStringLiteral("2026-10-16T08:30:00Z"));
        QCOMPARE(query.queryItemValue(QStringLiteral("end_date"), QUrl::FullyDecoded), QStringLiteral("2026-10-16T08:55:00Z"));

        // An entry with the same start but another stop is not the item.
        f.transport.respond(post + 1, FakeTransport::answer(200, listBody({entryJson(50, start, stop.addSecs(60))})));
        QCOMPARE(f.transport.requests.size(), post + 3);
        QVERIFY(f.is(post + 2, "POST", postPath));

        // A 2xx the client cannot read keeps the item: the next try finds
        // the entry on the server and drops it without a POST.
        f.transport.respond(post + 2, FakeTransport::answer(201, QByteArrayLiteral("<html>")));
        QCOMPARE(f.stored(owner).size(), 1);
        QCOMPARE(f.stored(owner).first().attempts, 3);
        for (int i = 0; i < 20; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.transport.requests.size(), post + 4);
        QVERIFY(f.is(post + 3, "GET", entriesPath));
        f.transport.respond(post + 3, FakeTransport::answer(200, listBody({entryJson(50, start, stop.addSecs(60)), entryJson(51, start, stop)})));
        QCOMPARE(f.transport.requests.size(), post + 4);
        QVERIFY(f.stored(owner).isEmpty());
        QVERIFY(f.queue->message().isEmpty());
    }

    void delayDoublesUpToFiveMinutes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const QString owner = f.connection.owner();
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p1"), owner, start, stop, f.clock.now()), std::nullopt));
        const qint64 delays[] = {5, 10, 20, 40, 80, 160, 300, 300};
        for (const qint64 delay : delays) {
            const qsizetype request = f.transport.requests.size() - 1;
            QCOMPARE(f.stored(owner).first().retryAt, f.clock.now().addSecs(delay));
            if (f.is(request, "GET", entriesPath)) {
                f.transport.respond(request, FakeTransport::failure(HttpResponse::Outcome::NetworkError));
            } else {
                QVERIFY(f.is(request, "POST", postPath));
                f.transport.respond(request, FakeTransport::failure(HttpResponse::Outcome::Timeout));
            }
            // A failed lookup or POST keeps the item, and the next tick at
            // its retryAt tries again.
            QCOMPARE(f.stored(owner).size(), 1);
            f.clock.advance(delay * 1000 - 1);
            QCOMPARE(f.transport.requests.size(), request + 1);
            f.clock.advance(1);
            QCOMPARE(f.transport.requests.size(), request + 2);
        }
    }

    void dropsWhatTheServerRefusesForGood()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QSignalSpy messages(f.queue.get(), &PomodoroQueue::messageChanged);
        const QString owner = f.connection.owner();
        const QDateTime now = f.clock.now();
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p1"), owner, start, stop, now), std::nullopt));
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p2"), owner, stop, stop.addSecs(600), now), std::nullopt));
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p3"), owner, stop.addSecs(600), stop.addSecs(1200), now), std::nullopt));

        // A 422 drops the item with the server's message; the next item
        // goes out.
        qsizetype request = f.transport.requests.size() - 1;
        f.transport.respond(request, FakeTransport::answer(422, message("Entry overlaps another")));
        QCOMPARE(f.queue->message(), QStringLiteral("Entry overlaps another"));
        QCOMPARE(messages.size(), 1);
        QCOMPARE(f.stored(owner).size(), 2);
        QCOMPARE(f.stored(owner).first().id, QStringLiteral("p2"));
        f.queue->clearMessage();
        QVERIFY(f.queue->message().isEmpty());
        QCOMPARE(messages.size(), 2);

        // 408 and 429 keep the item. The 429 starts the connection's
        // cooldown, so nothing more is sent until it ends.
        request = f.transport.requests.size() - 1;
        QVERIFY(f.is(request, "POST", postPath));
        f.transport.respond(request, FakeTransport::answer(408, message("Request timeout")));
        QCOMPARE(f.stored(owner).size(), 2);
        QCOMPARE(f.stored(owner).first().attempts, 1);
        QVERIFY(f.queue->message().isEmpty());
        // The third item went out in its turn.
        request = f.transport.requests.size() - 1;
        QVERIFY(f.is(request, "POST", postPath));
        QCOMPARE(f.body(request).value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T09:05:00Z"));
        f.transport.respond(request, FakeTransport::answer(429, message("Slow down"), QByteArrayLiteral("1")));
        QCOMPARE(f.stored(owner).size(), 2);
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        QVERIFY(f.queue->message().isEmpty());
        f.clock.advance(5000);
        QCOMPARE(f.transport.requests.size(), request + 1);

        // A 401 keeps the item as well. It ends the account, so the queue
        // resumes once the user reconnects, with a lookup first.
        QVERIFY(QTest::qWaitFor([&] {
            return f.connection.state() != Connection::RateLimited;
        }));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.size(), request + 2);
        QVERIFY(f.is(request + 1, "GET", entriesPath));
        f.transport.respond(request + 1, FakeTransport::answer(401, message("Token revoked")));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QCOMPARE(f.stored(owner).size(), 2);
        QCOMPARE(f.transport.requests.size(), request + 2);
        f.clock.advance(600 * 1000);
        QCOMPARE(f.transport.requests.size(), request + 2);

        f.connection.reconnect();
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == request + 3;
        }));
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.size(), request + 4);
        QVERIFY(f.is(request + 3, "GET", entriesPath));
        QVERIFY(f.queue->message().isEmpty());
    }

    void resumesAfterARestartForTheOwnerOnly()
    {
        Fixture f(false);
        // What a device holds before the app starts: two items of the
        // account that will connect, one not due yet, and one of another.
        const QString ownerA = QStringLiteral("https://a.example.test/ 3 7");
        const QString ownerB = QStringLiteral("https://b.example.test/tokkl/ 3 7");
        const QDateTime now = f.clock.now();
        PomodoroRecord recordA;
        recordA.config = PomodoroConfig{30, 5, 15, 4};
        recordA.unsaved = {item(QStringLiteral("a1"), ownerA, start, stop, now.addSecs(-60)), item(QStringLiteral("a2"), ownerA, stop, stop.addSecs(600), now.addSecs(3600))};
        recordA.unsaved.last().attempts = 2;
        PomodoroRecord recordB;
        recordB.unsaved = {item(QStringLiteral("b1"), ownerB, start, stop, now.addSecs(-60))};
        QVERIFY(f.store.saveRecord(ownerA, recordA.toJson()));
        QVERIFY(f.store.saveRecord(ownerB, recordB.toJson()));

        // Nothing is sent before an account is bound. Connecting tries
        // every item of the owner, due or not, one at a time.
        PomodoroQueue restarted(&f.connection, &f.clock, &f.store);
        f.clock.advance(1000);
        QCOMPARE(f.transport.requests.size(), 0);
        QVERIFY(connectAccount(f));
        QCOMPARE(f.connection.owner(), ownerA);
        const qsizetype first = f.transport.requests.size() - 1;
        QVERIFY(f.is(first, "POST", postPath));
        QCOMPARE(f.body(first).value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T08:30:00Z"));
        f.transport.respond(first, FakeTransport::answer(200, entryBody(100, start, stop)));
        QCOMPARE(f.transport.requests.size(), first + 2);
        QVERIFY(f.is(first + 1, "GET", entriesPath));
        f.transport.respond(first + 1, FakeTransport::answer(200, listBody({})));
        QVERIFY(f.is(first + 2, "POST", postPath));
        QCOMPARE(f.body(first + 2).value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T08:55:00Z"));
        f.transport.respond(first + 2, FakeTransport::answer(200, entryBody(101, stop, stop.addSecs(600))));
        QCOMPARE(f.transport.requests.size(), first + 3);
        QVERIFY(f.stored(ownerA).isEmpty());
        QCOMPARE(PomodoroRecord::fromJson(f.store.loadRecord(ownerA)).config, recordA.config);
        QCOMPARE(f.stored(ownerB), recordB.unsaved);
        QVERIFY(restarted.message().isEmpty());
    }

    void flushForSignOutPostsOnlyTheUntried()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const QString owner = f.connection.owner();
        const QDateTime now = f.clock.now();
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p1"), owner, start, stop, now), session(now)));
        const qsizetype first = f.transport.requests.size() - 1;
        QVERIFY(f.is(first, "POST", postPath));
        f.transport.respond(first, FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p2"), owner, stop, stop.addSecs(600), now), session(now)));
        QVERIFY(f.queue->enqueue(item(QStringLiteral("p3"), owner, stop.addSecs(600), stop.addSecs(1200), now), session(now)));
        QCOMPARE(f.transport.requests.size(), first + 2);
        QCOMPARE(f.stored(owner).size(), 3);

        // p1 was tried and p2 is in flight: only p3 is posted, with the
        // attempt on record first, and then nothing of the owner is left.
        const qsizetype writes = f.store.writes.size();
        f.queue->flushForSignOut();
        QCOMPARE(f.transport.requests.size(), first + 3);
        QVERIFY(f.is(first + 2, "POST", postPath));
        QCOMPARE(f.body(first + 2).value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T09:05:00Z"));
        QCOMPARE(f.body(first + 2).value(QLatin1String("stop")).toString(), QStringLiteral("2026-10-16T09:15:00Z"));
        QCOMPARE(f.request(first + 2).authorization, f.request(first).authorization);
        QCOMPARE(f.store.writes.size(), writes + 2);
        QCOMPARE(f.store.writes.at(writes).requestsBefore, first + 2);
        QCOMPARE(f.store.writes.at(writes).record.unsaved.size(), 3);
        QCOMPARE(f.store.writes.at(writes).record.unsaved.last().attempts, 1);
        QVERIFY(f.stored(owner).isEmpty());
        QCOMPARE(PomodoroRecord::fromJson(f.store.loadRecord(owner)).session, session(now));

        // The replies, and the reconfiguration that follows, change nothing.
        f.transport.respond(first + 1, FakeTransport::answer(200, entryBody(100, stop, stop.addSecs(600))));
        f.transport.respond(first + 2, FakeTransport::answer(422, message("Refused")));
        QCOMPARE(f.transport.requests.size(), first + 3);
        QVERIFY(f.stored(owner).isEmpty());
        QVERIFY(configure(f, instanceB));
        f.clock.advance(1000);
        QCOMPARE(f.transport.requests.size(), first + 4);
        QVERIFY(f.stored(owner).isEmpty());
    }
};

QTEST_GUILESS_MAIN(PomodoroQueueTest)
#include "pomodoroqueuetest.moc"
