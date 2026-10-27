// The companion's connection and timer controller against real Tokkl
// servers, over HTTP. realserver.test.ts in this directory starts the servers
// with the API's multi-user test fixtures, puts a proxy in front of each
// instance that can hold a reply back, and runs this binary with the fixture
// description in TOKKL_REALSERVER_FIXTURE. It checks the servers' data after
// this binary exits. Run it through realserver.test.ts, not on its own.
//
// Only the credential store and the clock are fakes: the store so no wallet
// is needed, the clock so polling can be moved forward without waiting.

#include "apitypes.h"
#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "timercontroller.h"
#include "transport.h"

#include <QEventLoop>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTest>

#include <memory>
#include <optional>

using namespace Tokkl;

namespace
{
constexpr int timeoutMs = 15000;
// How long a check for "nothing else happens" waits in real time, on top of
// moving the fake clock past several poll intervals.
constexpr int quietMs = 2000;
// The instances' default time resolution, in seconds.
constexpr qint64 resolutionSeconds = 300;

struct Entry {
    qint64 id = 0;
    qint64 workspaceId = 0;
    QString description;
    QDateTime start;
    std::optional<qint64> projectId;
    std::optional<qint64> taskId;
    QStringList tags; // sorted
    bool billable = false;
};

struct User {
    QString key;
    QString instance; // "a" or "b"
    QString url;
    qint64 id = 0;
    qint64 workspaceId = 0;
    QString email;
    QString token;
    QString password;
    QList<std::pair<qint64, QString>> projects; // id and name, by id
    std::optional<Entry> running;
};

struct Fixture {
    QString control;
    QHash<QString, QString> instances;
    QHash<QString, User> users;
};

Fixture fixture;

bool loadFixture(QString *error)
{
    const QByteArray raw = qgetenv("TOKKL_REALSERVER_FIXTURE");
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(raw, &parseError);
    if (raw.isEmpty() || !document.isObject()) {
        *error = QStringLiteral("TOKKL_REALSERVER_FIXTURE is missing or not a JSON object; run realserver.test.ts");
        return false;
    }
    const QJsonObject root = document.object();
    fixture.control = root.value(QStringLiteral("control")).toString();
    const QJsonObject instances = root.value(QStringLiteral("instances")).toObject();
    for (auto it = instances.begin(); it != instances.end(); ++it) {
        fixture.instances.insert(it.key(), it.value().toString());
    }
    const QJsonObject users = root.value(QStringLiteral("users")).toObject();
    for (auto it = users.begin(); it != users.end(); ++it) {
        const QJsonObject object = it.value().toObject();
        User user;
        user.key = it.key();
        user.instance = object.value(QStringLiteral("instance")).toString();
        user.url = fixture.instances.value(user.instance);
        user.id = object.value(QStringLiteral("id")).toInteger();
        user.workspaceId = object.value(QStringLiteral("wid")).toInteger();
        user.email = object.value(QStringLiteral("email")).toString();
        user.token = object.value(QStringLiteral("token")).toString();
        user.password = object.value(QStringLiteral("password")).toString();
        for (const QJsonValue &project : object.value(QStringLiteral("projects")).toArray()) {
            user.projects.append({project[QStringLiteral("id")].toInteger(), project[QStringLiteral("name")].toString()});
        }
        const QJsonValue running = object.value(QStringLiteral("running"));
        if (running.isObject()) {
            Entry entry;
            entry.id = running[QStringLiteral("id")].toInteger();
            entry.workspaceId = running[QStringLiteral("wid")].toInteger();
            entry.description = running[QStringLiteral("description")].toString();
            entry.start = QDateTime::fromString(running[QStringLiteral("start")].toString(), Qt::ISODateWithMs);
            if (running[QStringLiteral("project_id")].isDouble()) {
                entry.projectId = running[QStringLiteral("project_id")].toInteger();
            }
            if (running[QStringLiteral("task_id")].isDouble()) {
                entry.taskId = running[QStringLiteral("task_id")].toInteger();
            }
            for (const QJsonValue &tag : running[QStringLiteral("tags")].toArray()) {
                entry.tags.append(tag.toString());
            }
            entry.billable = running[QStringLiteral("billable")].toBool();
            user.running = entry;
        }
        fixture.users.insert(user.key, user);
    }
    if (fixture.control.isEmpty() || fixture.instances.size() != 2 || fixture.users.isEmpty()) {
        *error = QStringLiteral("TOKKL_REALSERVER_FIXTURE lacks the control URL, the two instances or the users");
        return false;
    }
    return true;
}

// One request the companion sent, and the answer when it came.
struct Exchange {
    HttpRequest request;
    std::optional<HttpResponse> response;
};

// The real transport, recording what goes through it.
class RecordingTransport : public Transport
{
    Q_OBJECT

public:
    using Transport::Transport;

    PendingReply *send(const HttpRequest &request) override
    {
        auto exchange = std::make_shared<Exchange>(Exchange{request, std::nullopt});
        log.append(exchange);
        PendingReply *reply = m_inner.send(request);
        // Connected before the caller gets the reply, so this runs first.
        connect(reply, &PendingReply::finished, this, [exchange](const HttpResponse &response) {
            exchange->response = response;
        });
        return reply;
    }

    // Streams pass through unrecorded.
    PendingStream *openStream(const HttpRequest &request) override
    {
        return m_inner.openStream(request);
    }

    // Requests from index `from` on that match the method and a path suffix
    // (the path after /api/v9, query excluded).
    QList<std::shared_ptr<Exchange>> since(qsizetype from, const QByteArray &method = {}, const QString &path = {}) const
    {
        QList<std::shared_ptr<Exchange>> found;
        for (qsizetype i = from; i < log.size(); ++i) {
            const auto &exchange = log.at(i);
            if ((method.isEmpty() || exchange->request.method == method)
                && (path.isEmpty() || exchange->request.url.path().endsWith(QStringLiteral("/api/v9") + path))) {
                found.append(exchange);
            }
        }
        return found;
    }

    QList<std::shared_ptr<Exchange>> log;

private:
    NetworkTransport m_inner{QStringLiteral("tokkl-kde")};
};

// The companion as the widget assembles it, with the fake store and clock.
// It sends the widget's client name, which realserver.test.ts checks in
// created_with.
struct Session {
    FakeCredentialStore store;
    RecordingTransport transport;
    Connection connection{&transport, &store, QStringLiteral("tokkl-kde")};
    FakeClock clock;
    TimerController timer{&clock};

    Session()
    {
        clock.current = QDateTime::currentDateTimeUtc();
        timer.setConnection(&connection);
    }

    QString keyFor(const User &user, AuthMode mode) const
    {
        return credentialKey(parseInstanceUrl(user.url), mode, mode == AuthMode::Password ? user.email : QString());
    }

    void signIn(const User &user, AuthMode mode = AuthMode::Token)
    {
        store.secrets.insert(keyFor(user, mode), mode == AuthMode::Password ? user.password : user.token);
        connection.setAuthMode(mode);
        connection.setEmail(mode == AuthMode::Password ? user.email : QString());
        connection.setInstanceUrl(user.url);
    }

    // Replaces the stored token for the same instance, as saving another
    // account's token on the Configure page does.
    void replaceToken(const User &user)
    {
        bool written = false;
        store.write(keyFor(user, AuthMode::Token), user.token, &store, [&written](const CredentialResult &) {
            written = true;
        });
        QTRY_VERIFY_WITH_TIMEOUT(written, timeoutMs);
    }

    // Moves the fake clock across several poll intervals and lets real time
    // pass, so a retry or poll loop would show in the log.
    void idle()
    {
        for (int i = 0; i < 4; ++i) {
            clock.advance(TimerController::pollIntervalMs);
        }
        QTest::qWait(quietMs);
    }

    QList<std::pair<qint64, QString>> projects() const
    {
        QList<std::pair<qint64, QString>> list;
        for (const Project &project : connection.projects()) {
            list.append({project.id, project.name});
        }
        std::sort(list.begin(), list.end());
        return list;
    }

    bool ready(const User &user) const
    {
        return connection.account() && connection.account()->id == user.id && connection.workspaceId() == user.workspaceId
            && connection.instanceUrl() == user.url && timer.canWrite() && projects() == user.projects;
    }
};

// A blocking JSON request to the fixture's control server.
std::optional<QJsonObject> control(const QString &path, const QJsonObject &body = {})
{
    QNetworkAccessManager manager;
    QNetworkRequest request(QUrl(fixture.control + path));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = manager.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    QEventLoop loop;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();
    reply->deleteLater();
    if (reply->error() != QNetworkReply::NoError) {
        qWarning() << "control" << path << reply->errorString() << reply->readAll();
        return std::nullopt;
    }
    return QJsonDocument::fromJson(reply->readAll()).object();
}

int heldReplies(const QString &instance)
{
    const auto answer = control(QStringLiteral("/held"), {{QStringLiteral("instance"), instance}});
    return answer ? answer->value(QStringLiteral("held")).toInt() : -1;
}

// The proxy forwards the next matching request and keeps its answer until
// release().
bool hold(const QString &instance, const QByteArray &method, const QString &path)
{
    return control(QStringLiteral("/hold"),
                   {{QStringLiteral("instance"), instance},
                    {QStringLiteral("method"), QString::fromLatin1(method)},
                    {QStringLiteral("path"), QString(QStringLiteral("/api/v9") + path)}})
        .has_value();
}

bool release(const QString &instance)
{
    return control(QStringLiteral("/release"), {{QStringLiteral("instance"), instance}}).has_value();
}

// A request outside the companion's own flow, with its encoders and transport.
HttpResponse sendRaw(const QByteArray &method, const User &user, const QByteArray &authorization, const QString &path, const QByteArray &body = {})
{
    NetworkTransport transport(QStringLiteral("tokkl-kde"));
    PendingReply *reply = transport.send(HttpRequest{method, parseInstanceUrl(user.url).api(path), authorization, body});
    HttpResponse answer;
    QEventLoop loop;
    QObject::connect(reply, &PendingReply::finished, &loop, [&](const HttpResponse &response) {
        answer = response;
        loop.quit();
    });
    loop.exec();
    return answer;
}

QByteArray tokenAuthorization(const User &user)
{
    return basicAuthorization(AuthMode::Token, QString(), user.token);
}

bool isWrite(const QByteArray &method)
{
    return method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE";
}

QStringList sorted(QStringList list)
{
    list.sort();
    return list;
}

// The companion's H:MM, in whole minutes.
QString hoursAndMinutes(qint64 seconds)
{
    return QStringLiteral("%1:%2").arg(seconds / 3600).arg((seconds % 3600) / 60, 2, 10, QLatin1Char('0'));
}
}

class RealServerTest : public QObject
{
    Q_OBJECT

    const User &user(const QString &key)
    {
        if (!fixture.users.contains(key)) {
            qFatal("fixture user %s is missing", qPrintable(key));
        }
        return fixture.users[key];
    }

    // The answer every refused credential gets, from a token that never existed.
    HttpResponse unknownTokenAnswer(const User &anyone)
    {
        return sendRaw("GET", anyone, basicAuthorization(AuthMode::Token, QString(), QStringLiteral("0000000000000000000000000000dead")), QStringLiteral("/me"));
    }

    // After a refusal: no account data, no writes, a message that does not
    // claim to know why, and no request until the user reconnects.
    void checkRefusedAndQuiet(Session &s)
    {
        QCOMPARE(s.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(!s.connection.account());
        QCOMPARE(s.connection.workspaceId(), 0);
        QVERIFY(s.connection.projects().isEmpty());
        QVERIFY(!s.connection.currentEntry());
        QVERIFY(!s.timer.currentEntry());
        QVERIFY(s.timer.projects().isEmpty());
        QVERIFY(!s.timer.canWrite());
        QVERIFY(!s.connection.canWrite());
        QVERIFY2(!s.connection.errorString().contains(QLatin1String("disabl"), Qt::CaseInsensitive), qPrintable(s.connection.errorString()));

        const qsizetype before = s.transport.log.size();
        QVERIFY(!s.timer.start());
        QVERIFY(!s.timer.stop());
        s.idle();
        QCOMPARE(s.transport.log.size(), before);

        // An explicit reconnect asks once more and stops again.
        s.connection.reconnect();
        QTRY_COMPARE_WITH_TIMEOUT(s.transport.since(before).size(), 1, timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.transport.since(before).first()->response.has_value(), timeoutMs);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);
        QCOMPARE(s.transport.since(before).first()->response->status, 403);
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        s.idle();
        QCOMPARE(s.transport.log.size(), before + 1);
    }

private Q_SLOTS:
    void initTestCase()
    {
        QString error;
        QVERIFY2(loadFixture(&error), qPrintable(error));
        QVERIFY(heldReplies(QStringLiteral("a")) == 0);
    }

    // A user who is not an admin and whose workspace is not 1 sees only their
    // own projects and timer, and the server refuses their requests against
    // another workspace.
    void isolation()
    {
        const User &u = user(QStringLiteral("a.u"));
        const User &admin = user(QStringLiteral("a.admin"));
        QVERIFY(u.workspaceId != 1);
        QVERIFY(admin.running);
        QVERIFY(!u.running);

        Session s;
        s.signIn(u);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(u), timeoutMs);
        QVERIFY(!s.timer.currentEntry()); // the admin's running timer is not shown
        for (const auto &[id, name] : admin.projects) {
            QVERIFY2(!s.projects().contains(std::make_pair(id, name)), qPrintable(name));
        }

        QVERIFY(s.timer.start());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->workspaceId, u.workspaceId);
        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        for (const auto &exchange : s.transport.log) {
            QVERIFY2(!exchange->request.url.path().contains(QStringLiteral("/workspaces/%1/").arg(admin.workspaceId)),
                     qPrintable(exchange->request.url.toString()));
        }

        // The companion's own encoders, aimed at the admin's workspace.
        const QByteArray auth = tokenAuthorization(u);
        const QString foreign = QStringLiteral("/workspaces/%1/time_entries").arg(admin.workspaceId);
        const QList<std::tuple<QByteArray, QString, QByteArray>> attempts = {
            {"POST", foreign, encodeStartEntry(StartEntry{QDateTime::currentDateTimeUtc(), QString(), std::nullopt, false, std::nullopt, {}}, admin.workspaceId, QStringLiteral("tokkl-kde"))},
            {"PATCH", foreign + QStringLiteral("/%1/stop").arg(admin.running->id), QByteArray()},
            {"PUT", foreign + QStringLiteral("/%1").arg(admin.running->id), encodeTimeEntryUpdate(TimeEntryUpdate{QStringLiteral("changed by another user"), {}, {}, true, {}})},
        };
        for (const auto &[method, path, body] : attempts) {
            const HttpResponse response = sendRaw(method, u, auth, path, body);
            QCOMPARE(response.outcome, HttpResponse::Outcome::Finished);
            QVERIFY2(response.status == 403, qPrintable(QStringLiteral("%1 %2: %3").arg(QString::fromLatin1(method), path).arg(response.status)));
            QCOMPARE(errorFromResponse(response).kind, ApiError::Kind::Forbidden);
        }
    }

    // Switching accounts on one instance: replies to the old account that
    // arrive late, a read and a start, change nothing for the new one, and the
    // start is not sent again.
    void userSwitchWithLateReplies()
    {
        const User &admin = user(QStringLiteral("a.admin"));
        const User &u = user(QStringLiteral("a.u"));

        Session s;
        s.signIn(admin);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(admin), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, admin.running->id);

        // A late read of the admin's running entry.
        QVERIFY(hold(QStringLiteral("a"), "GET", QStringLiteral("/me/time_entries/current")));
        s.timer.refresh();
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        const auto heldRead = s.transport.since(0, "GET", QStringLiteral("/me/time_entries/current")).last();
        s.replaceToken(u);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(u), timeoutMs);
        QVERIFY(release(QStringLiteral("a")));
        QTRY_VERIFY_WITH_TIMEOUT(heldRead->response.has_value(), timeoutMs);
        QCOMPARE(heldRead->response->outcome, HttpResponse::Outcome::Aborted);
        QTest::qWait(500);
        QVERIFY(s.ready(u));
        QVERIFY(!s.timer.currentEntry());

        // A late start by u, answered after the switch back to the admin.
        const qsizetype beforeStart = s.transport.log.size();
        QVERIFY(hold(QStringLiteral("a"), "POST", QStringLiteral("/workspaces/%1/time_entries").arg(u.workspaceId)));
        QVERIFY(s.timer.start());
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        const qsizetype switchedAt = s.transport.log.size();
        s.replaceToken(admin);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(admin), timeoutMs);
        QVERIFY(release(QStringLiteral("a")));
        QTest::qWait(500);
        s.idle();

        QVERIFY(s.ready(admin));
        QCOMPARE(s.timer.currentEntry()->id, admin.running->id);
        QCOMPARE(s.timer.currentEntry()->description, admin.running->description);
        QCOMPARE(s.transport.since(beforeStart, "POST").size(), 1); // never sent again
        for (const auto &exchange : s.transport.since(switchedAt)) {
            QVERIFY2(!isWrite(exchange->request.method), exchange->request.method.constData());
            QCOMPARE(exchange->request.authorization, tokenAuthorization(admin));
        }
    }

    // Switching instances where every id collides: the user, workspace,
    // project and running entry ids are the same on both. A late reply from
    // the old instance changes nothing, and a stop goes to the new one only.
    void crossInstanceCollidingIds()
    {
        const User &a = user(QStringLiteral("a.s"));
        const User &b = user(QStringLiteral("b.s"));
        QVERIFY(a.running && b.running);
        QCOMPARE(b.id, a.id);
        QCOMPARE(b.workspaceId, a.workspaceId);
        QCOMPARE(b.running->id, a.running->id);
        QCOMPARE(b.projects.size(), a.projects.size());
        QCOMPARE(b.projects.first().first, a.projects.first().first);
        QVERIFY(b.projects != a.projects);
        QVERIFY(b.running->start != a.running->start);

        Session s;
        s.signIn(a);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(a), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->description, a.running->description);
        QCOMPARE(s.timer.currentEntry()->start, a.running->start);

        QVERIFY(hold(QStringLiteral("a"), "GET", QStringLiteral("/me/time_entries/current")));
        s.timer.refresh();
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        const qsizetype switchedAt = s.transport.log.size();
        s.signIn(b);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(b), timeoutMs);
        QVERIFY(release(QStringLiteral("a")));
        QTest::qWait(500);

        QVERIFY(s.ready(b));
        QCOMPARE(s.timer.currentEntry()->id, b.running->id);
        QCOMPARE(s.timer.currentEntry()->description, b.running->description);
        QCOMPARE(s.timer.currentEntry()->start, b.running->start);

        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        const QString bOrigin = QUrl(b.url).authority();
        for (const auto &exchange : s.transport.since(switchedAt)) {
            QCOMPARE(exchange->request.url.authority(), bOrigin);
        }
        QCOMPARE(s.transport.since(switchedAt, "PATCH", QStringLiteral("/workspaces/%1/time_entries/%2/stop").arg(b.workspaceId).arg(b.running->id)).size(), 1);
    }

    // The account loses the workspace it works in. The stop is refused with
    // 403, the companion asks /me once, blocks writes and polling, and does
    // not send the stop again. The credentials are not treated as refused.
    void membershipLoss()
    {
        const User &m = user(QStringLiteral("a.m"));
        const User &admin = user(QStringLiteral("a.admin"));
        QCOMPARE(m.workspaceId, admin.workspaceId); // works in the admin's workspace
        QVERIFY(m.running);

        Session s;
        s.signIn(m);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(m), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, m.running->id);

        QVERIFY(control(QStringLiteral("/remove-membership"), {{QStringLiteral("user"), m.key}, {QStringLiteral("wid"), m.workspaceId}}));
        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.workspaceAccessLost(), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(!s.transport.since(before, "GET", QStringLiteral("/me")).isEmpty()
                                     && s.transport.since(before, "GET", QStringLiteral("/me")).first()->response,
                                 timeoutMs);
        s.idle();

        const auto stops = s.transport.since(before, "PATCH");
        QCOMPARE(stops.size(), 1);
        QCOMPARE(stops.first()->response->status, 403);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);
        QCOMPARE(s.transport.since(before).size(), 2);
        QCOMPARE(s.connection.state(), Connection::Connected);
        QVERIFY(s.timer.workspaceAccessLost());
        QVERIFY(!s.timer.canWrite());
        QVERIFY(!s.timer.currentEntry());
        QVERIFY(s.timer.projects().isEmpty());
        QVERIFY(!s.timer.start());
        QCOMPARE(s.transport.since(before).size(), 2);
    }

    // The admin disables an account while the companion has a write to send.
    // The stop's 403 alone is not taken as refused credentials: /me is asked
    // once, and its 403 is.
    void disabledTokenDuringWrite()
    {
        const User &dt = user(QStringLiteral("a.dt"));
        QVERIFY(dt.running);

        Session s;
        s.signIn(dt);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(dt), timeoutMs);
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dt.key}}));

        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        const auto all = s.transport.since(before);
        QCOMPARE(all.size(), 2);
        QCOMPARE(all.at(0)->request.method, QByteArray("PATCH"));
        QCOMPARE(all.at(0)->response->status, 403);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);

        // The same answer as for a token that never existed.
        const HttpResponse unknown = unknownTokenAnswer(dt);
        QCOMPARE(all.at(1)->response->status, 403);
        QCOMPARE(unknown.status, 403);
        QCOMPARE(all.at(1)->response->body, unknown.body);
        QCOMPARE(all.at(0)->response->body, unknown.body);

        checkRefusedAndQuiet(s);
    }

    // The same with email and password, refused on a read of the running entry.
    void disabledPasswordOnRead()
    {
        const User &dp = user(QStringLiteral("a.dp"));
        QVERIFY(dp.running);
        QVERIFY(!dp.password.isEmpty());

        Session s;
        s.signIn(dp, AuthMode::Password);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(dp), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, dp.running->id);
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dp.key}}));

        const qsizetype before = s.transport.log.size();
        s.timer.refresh();
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        QTest::qWait(500);
        // The entry read refuses the credentials; the projects read sent with
        // it may be refused first and trigger one /me. Nothing is written.
        const auto all = s.transport.since(before);
        QVERIFY2(all.size() >= 2 && all.size() <= 3, qPrintable(QString::number(all.size())));
        QVERIFY(s.transport.since(before, "GET", QStringLiteral("/me")).size() <= 1);
        for (const auto &exchange : all) {
            QCOMPARE(exchange->request.method, QByteArray("GET"));
            QCOMPARE(exchange->request.authorization, basicAuthorization(AuthMode::Password, dp.email, dp.password));
            if (exchange->response && exchange->response->outcome == HttpResponse::Outcome::Finished) {
                QCOMPARE(exchange->response->status, 403);
                QCOMPARE(exchange->response->body, unknownTokenAnswer(dp).body);
            }
        }

        checkRefusedAndQuiet(s);
    }

    // Pause and resume against the server. The clone copies the task, the
    // tags and the billable flag, and the chain total is what the server
    // stored for the stopped entries. Once the task, and then the project, are
    // gone, a resume is refused with 404 and the server's message, creates
    // nothing and leaves the chain paused. The message stays through the
    // reads that follow; stop then only clears the chain and the message.
    void pauseAndResume()
    {
        const User &p = user(QStringLiteral("a.p"));
        QVERIFY(p.running && p.running->projectId && p.running->taskId && p.running->billable);
        QVERIFY(!p.running->tags.isEmpty());

        Session s;
        s.signIn(p);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(p), timeoutMs);
        const TimeEntry seeded = *s.timer.currentEntry();
        QCOMPARE(seeded.id, p.running->id);
        QCOMPARE(seeded.projectId, p.running->projectId);
        QCOMPARE(seeded.taskId, p.running->taskId);
        QCOMPARE(sorted(seeded.tags), p.running->tags);
        QVERIFY(seeded.billable);

        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        QVERIFY(!s.timer.isRunning());
        QVERIFY(!s.timer.currentEntry());
        const qint64 paused = s.timer.chainSeconds();
        QVERIFY2(paused > 0 && paused % resolutionSeconds == 0, qPrintable(QString::number(paused)));
        QCOMPARE(s.timer.elapsedSeconds(), paused);
        QCOMPARE(s.timer.elapsedText(), hoursAndMinutes(paused));

        const qsizetype beforeResume = s.transport.log.size();
        QVERIFY(s.timer.resume());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.transport.since(beforeResume, "POST").size(), 1);
        const TimeEntry clone = *s.timer.currentEntry();
        QVERIFY(clone.id != seeded.id);
        QCOMPARE(clone.workspaceId, p.workspaceId);
        QCOMPARE(clone.description, seeded.description);
        QCOMPARE(clone.projectId, seeded.projectId);
        QCOMPARE(clone.taskId, seeded.taskId);
        QCOMPARE(sorted(clone.tags), p.running->tags);
        QVERIFY(clone.billable);
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.chainSeconds(), paused);
        QVERIFY(s.timer.elapsedSeconds() >= paused);

        // The clone stops seconds after it started, under half a step, so the
        // server sends it to the trash at zero length and the total holds.
        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        const qint64 total = s.timer.chainSeconds();
        QCOMPARE(total, paused);
        QCOMPARE(s.timer.elapsedText(), hoursAndMinutes(total));

        const QByteArray auth = tokenAuthorization(p);
        const QString projectPath = QStringLiteral("/workspaces/%1/projects/%2").arg(p.workspaceId).arg(*p.running->projectId);
        // The server checks the task before the project, so a resume after the
        // project went with its task is refused for the task too.
        const QStringList removals = {projectPath + QStringLiteral("/tasks/%1").arg(*p.running->taskId), projectPath};
        QStringList errors;
        connect(&s.timer, &TimerController::statusChanged, this, [&s, &errors] {
            if (!s.timer.errorString().isEmpty() && (errors.isEmpty() || errors.last() != s.timer.errorString())) {
                errors.append(s.timer.errorString());
            }
        });
        for (const QString &path : removals) {
            QCOMPARE(sendRaw("DELETE", p, auth, path).status, 200);
            const qsizetype before = s.transport.log.size();
            errors.clear();
            QVERIFY(s.timer.resume());
            QTRY_VERIFY_WITH_TIMEOUT(s.transport.since(before, "POST").size() == 1 && s.transport.since(before, "POST").first()->response, timeoutMs);
            QCOMPARE(s.transport.since(before, "POST").first()->response->status, 404);
            // The read that follows the refusal.
            QTRY_VERIFY_WITH_TIMEOUT(!s.transport.since(before, "GET", QStringLiteral("/me/time_entries/current")).isEmpty()
                                         && s.transport.since(before, "GET", QStringLiteral("/me/time_entries/current")).last()->response
                                         && s.timer.canWrite(),
                                     timeoutMs);
            QCOMPARE(errors, QStringList{QStringLiteral("Task not found")});
            // The read leaves the refusal on show.
            QCOMPARE(s.timer.errorString(), QStringLiteral("Task not found"));
            QCOMPARE(s.timer.status(), TimerController::Error);
            QVERIFY(s.timer.isPaused());
            QVERIFY(!s.timer.isRunning());
            QCOMPARE(s.timer.chainSeconds(), total);
            QCOMPARE(s.timer.elapsedText(), hoursAndMinutes(total));
        }

        // Polls keep it too, until the next action.
        s.idle();
        QCOMPARE(s.timer.errorString(), QStringLiteral("Task not found"));
        QCOMPARE(s.timer.status(), TimerController::Error);
        QVERIFY(s.timer.isPaused());

        const qsizetype beforeStop = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QCOMPARE(s.timer.status(), TimerController::Ready);
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.errorString(), QString());
        QCOMPARE(s.timer.elapsedSeconds(), 0);
        QCOMPARE(s.timer.elapsedText(), QStringLiteral("0:00"));
        s.idle();
        for (const auto &exchange : s.transport.since(beforeStop)) {
            QVERIFY2(!isWrite(exchange->request.method), exchange->request.method.constData());
        }
        QVERIFY(!s.timer.currentEntry());
    }

    // A chain with a project and no task: once the project is gone, a resume
    // is refused with 404 and "Project not found", creates nothing and leaves
    // the chain paused with the message through the reads that follow.
    void resumeRefusedForDeletedProject()
    {
        const User &q = user(QStringLiteral("a.q"));
        QVERIFY(q.running && q.running->projectId && !q.running->taskId);

        Session s;
        s.signIn(q);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(q), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, q.running->id);

        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        const qint64 paused = s.timer.chainSeconds();
        QVERIFY2(paused > 0 && paused % resolutionSeconds == 0, qPrintable(QString::number(paused)));

        const QString projectPath = QStringLiteral("/workspaces/%1/projects/%2").arg(q.workspaceId).arg(*q.running->projectId);
        QCOMPARE(sendRaw("DELETE", q, tokenAuthorization(q), projectPath).status, 200);

        QStringList errors;
        connect(&s.timer, &TimerController::statusChanged, this, [&s, &errors] {
            if (!s.timer.errorString().isEmpty() && (errors.isEmpty() || errors.last() != s.timer.errorString())) {
                errors.append(s.timer.errorString());
            }
        });
        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.resume());
        QTRY_VERIFY_WITH_TIMEOUT(s.transport.since(before, "POST").size() == 1 && s.transport.since(before, "POST").first()->response, timeoutMs);
        QCOMPARE(s.transport.since(before, "POST").first()->response->status, 404);
        // The read that follows the refusal.
        QTRY_VERIFY_WITH_TIMEOUT(!s.transport.since(before, "GET", QStringLiteral("/me/time_entries/current")).isEmpty()
                                     && s.transport.since(before, "GET", QStringLiteral("/me/time_entries/current")).last()->response
                                     && s.timer.canWrite(),
                                 timeoutMs);
        QCOMPARE(errors, QStringList{QStringLiteral("Project not found")});
        QCOMPARE(s.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(s.timer.status(), TimerController::Error);
        QVERIFY(s.timer.isPaused());
        QVERIFY(!s.timer.isRunning());
        QCOMPARE(s.timer.chainSeconds(), paused);

        s.idle();
        QCOMPARE(s.transport.since(before, "POST").size(), 1);
        QCOMPARE(s.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(s.timer.status(), TimerController::Error);
        QVERIFY(s.timer.isPaused());

        const qsizetype beforeStop = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QCOMPARE(s.timer.status(), TimerController::Ready);
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.errorString(), QString());
        s.idle();
        for (const auto &exchange : s.transport.since(beforeStop)) {
            QVERIFY2(!isWrite(exchange->request.method), exchange->request.method.constData());
        }
        QVERIFY(!s.timer.currentEntry());
    }

    void cleanupTestCase()
    {
        QCOMPARE(heldReplies(QStringLiteral("a")), 0);
        QCOMPARE(heldReplies(QStringLiteral("b")), 0);
    }
};

QTEST_GUILESS_MAIN(RealServerTest)

#include "realservertest.moc"
