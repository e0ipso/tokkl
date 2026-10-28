// The companion's connection and timer controller against real Tokkl
// servers, over HTTP. realserver.test.ts in this directory starts the servers
// with the API's multi-user test fixtures, puts a proxy in front of each
// instance that can hold a reply back, and runs this binary with the fixture
// description in TOKKL_REALSERVER_FIXTURE. It checks the servers' data after
// this binary exits. Run it through realserver.test.ts, not on its own.
//
// Only the credential store, the Pomodoro mode store and the clock are fakes:
// the stores so no wallet or settings file is needed, the clock so polling can
// be moved forward without waiting.

#include "apitypes.h"
#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstateclient.h"
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
// The instances' time resolution, set by the fixture, in seconds.
constexpr qint64 resolutionSeconds = 60;
// How long a change made on the server may take to reach a companion whose
// stream is up.
constexpr int pushMs = 2000;

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
    // (the path after /api/v9, or after `api`, query excluded).
    QList<std::shared_ptr<Exchange>> since(qsizetype from, const QByteArray &method = {}, const QString &path = {}, const QString &api = QStringLiteral("/api/v9")) const
    {
        QList<std::shared_ptr<Exchange>> found;
        for (qsizetype i = from; i < log.size(); ++i) {
            const auto &exchange = log.at(i);
            if ((method.isEmpty() || exchange->request.method == method)
                && (path.isEmpty() || exchange->request.url.path().endsWith(api + path))) {
                found.append(exchange);
            }
        }
        return found;
    }

    // The same for the app's own API, such as /timer/pause.
    QList<std::shared_ptr<Exchange>> sinceApp(qsizetype from, const QByteArray &method = {}, const QString &path = {}) const
    {
        return since(from, method, path, QStringLiteral("/api/app"));
    }

    QList<std::shared_ptr<Exchange>> log;

private:
    NetworkTransport m_inner{QStringLiteral("tokkl-kde")};
};

bool isWrite(const QByteArray &method)
{
    return method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE";
}

// Pomodoro mode in memory.
class MemoryPomodoroStore : public PomodoroStore
{
public:
    bool loadPomodoroMode() override
    {
        return pomodoro;
    }

    bool savePomodoroMode(bool value) override
    {
        pomodoro = value;
        return true;
    }

    bool pomodoro = false;
};

// The companion as the widget assembles it, with the fake store and clock.
// It sends the widget's client name, which realserver.test.ts checks in
// created_with.
struct Session {
    FakeCredentialStore store;
    RecordingTransport transport;
    Connection connection{&transport, &store, QStringLiteral("tokkl-kde")};
    FakeClock clock;
    TimerStateClient state{&connection, &clock};
    TimerController timer{&clock};
    MemoryPomodoroStore pomodoroStore;
    PomodoroSession pomodoro{&clock, &timer, &state, &pomodoroStore};

    Session()
    {
        clock.current = QDateTime::currentDateTimeUtc();
        timer.setStateClient(&state);
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
    // pass, so a retry or poll loop would show in the log. The steps are
    // shorter than the gap between ticks that the state client takes for a
    // wake from sleep, which would read the state and replace the stream.
    void idle()
    {
        const int step = TimerStateClient::resumeGapMs / 2;
        for (int passed = 0; passed < 4 * TimerStateClient::pollIntervalMs; passed += step) {
            clock.advance(step);
        }
        QTest::qWait(quietMs);
    }

    // The reply to the last request since `from` with this method and app
    // path has arrived. A state from the stream may come first.
    bool answered(qsizetype from, const QByteArray &method, const QString &path) const
    {
        const auto found = transport.sinceApp(from, method, path);
        return !found.isEmpty() && found.last()->response.has_value();
    }

    // The paths of the writes sent since `from`, such as /timer/pause, after
    // /api/app. A write outside the app's API shows as its full path.
    QStringList writesSince(qsizetype from) const
    {
        QStringList paths;
        for (const auto &exchange : transport.since(from)) {
            if (isWrite(exchange->request.method)) {
                QString path = exchange->request.url.path();
                const qsizetype app = path.indexOf(QStringLiteral("/api/app"));
                paths.append(app >= 0 ? path.mid(app + 8) : path);
            }
        }
        return paths;
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

// The same for a request to the app's own API, such as /timer/pause.
bool holdApp(const QString &instance, const QByteArray &method, const QString &path)
{
    return control(QStringLiteral("/hold"),
                   {{QStringLiteral("instance"), instance},
                    {QStringLiteral("method"), QString::fromLatin1(method)},
                    {QStringLiteral("path"), QString(QStringLiteral("/api/app") + path)}})
        .has_value();
}

bool release(const QString &instance)
{
    return control(QStringLiteral("/release"), {{QStringLiteral("instance"), instance}}).has_value();
}

// While it lives, the proxy keeps the instance's event streams silent: what
// the server sends on them, an end included, waits until release().
class StreamStall
{
public:
    explicit StreamStall(const QString &instance)
        : m_instance(instance)
        , m_active(set(true))
    {
    }

    ~StreamStall()
    {
        release();
    }

    bool active() const
    {
        return m_active;
    }

    void release()
    {
        if (m_active) {
            set(false);
            m_active = false;
        }
    }

private:
    bool set(bool on) const
    {
        return control(QStringLiteral("/stall-streams"), {{QStringLiteral("instance"), m_instance}, {QStringLiteral("on"), on}}).has_value();
    }

    QString m_instance;
    bool m_active;
};

// How many requests with this method and app path the proxy has received
// from any client since the run began, whatever the companion logged.
int requestsSeen(const QString &instance, const QByteArray &method, const QString &path)
{
    const auto answer = control(QStringLiteral("/seen"),
                                {{QStringLiteral("instance"), instance},
                                 {QStringLiteral("method"), QString::fromLatin1(method)},
                                 {QStringLiteral("path"), QString(QStringLiteral("/api/app") + path)}});
    return answer ? answer->value(QStringLiteral("seen")).toInt() : -1;
}

// Cuts every held reply off before its last byte and closes the connection.
// The server has acted on the request. A connection that closes before the
// first byte of the reply would make Qt send the request again by itself.
bool dropHeld(const QString &instance)
{
    const auto answer = control(QStringLiteral("/drop"), {{QStringLiteral("instance"), instance}});
    return answer && answer->value(QStringLiteral("dropped")).toInt() > 0;
}

// A request to the app's API as the user, from outside the companion: another
// device of the same account. The proxy never sees it.
struct Answer {
    int status = 0;
    QJsonObject body;
};

Answer callAs(const User &user, const QByteArray &method, const QString &path, const QJsonObject &body = {})
{
    QJsonObject request{{QStringLiteral("user"), user.key},
                        {QStringLiteral("method"), QString::fromLatin1(method)},
                        {QStringLiteral("path"), QString(QStringLiteral("/api/app") + path)}};
    if (!body.isEmpty()) {
        request.insert(QStringLiteral("body"), body);
    }
    const auto answer = control(QStringLiteral("/call"), request);
    return answer ? Answer{answer->value(QStringLiteral("status")).toInt(), answer->value(QStringLiteral("body")).toObject()} : Answer{};
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

// The requests as one line each, for the message of a failed check.
QString describe(const QList<std::shared_ptr<Exchange>> &exchanges)
{
    QStringList lines;
    for (const auto &exchange : exchanges) {
        QString answer = QStringLiteral("no answer yet");
        if (exchange->response) {
            answer = exchange->response->outcome == HttpResponse::Outcome::Finished ? QString::number(exchange->response->status)
                                                                                    : QStringLiteral("not answered");
        }
        lines.append(QStringLiteral("%1 %2 -> %3").arg(QString::fromLatin1(exchange->request.method), exchange->request.url.path(), answer));
    }
    return lines.join(QLatin1String("; "));
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
        QVERIFY(holdApp(QStringLiteral("a"), "GET", QStringLiteral("/timer")));
        s.timer.refresh();
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        const auto heldRead = s.transport.sinceApp(0, "GET", QStringLiteral("/timer")).last();
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

        QVERIFY(holdApp(QStringLiteral("a"), "GET", QStringLiteral("/timer")));
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

        s.idle();

        const auto stops = s.transport.since(before, "PATCH");
        QCOMPARE(stops.size(), 1);
        QCOMPARE(stops.first()->response->status, 403);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);
        QVERIFY2(s.transport.since(before).size() == 2, qPrintable(describe(s.transport.since(before))));
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
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        // The server ends the account's stream when it disables it. The stream
        // goes silent first, so the stop is the first request to be refused.
        StreamStall stall(QStringLiteral("a"));
        QVERIFY(stall.active());
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dt.key}}));

        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        const auto all = s.transport.since(before);
        QVERIFY2(all.size() == 2, qPrintable(describe(all)));
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

    // The same with email and password, refused on a read of the timer.
    void disabledPasswordOnRead()
    {
        const User &dp = user(QStringLiteral("a.dp"));
        QVERIFY(dp.running);
        QVERIFY(!dp.password.isEmpty());

        Session s;
        s.signIn(dp, AuthMode::Password);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(dp), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, dp.running->id);
        // As above, the read is the first request to be refused.
        StreamStall stall(QStringLiteral("a"));
        QVERIFY(stall.active());
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dp.key}}));

        const qsizetype before = s.transport.log.size();
        s.timer.refresh();
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        QTest::qWait(500);
        // The entry read refuses the credentials; the projects read sent with
        // it may be refused first and trigger one /me. Nothing is written.
        const auto all = s.transport.since(before);
        QVERIFY2(all.size() >= 2 && all.size() <= 3, qPrintable(describe(all)));
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
    // stored for the stopped entries. Another client deletes the task and then
    // the project while the chain is paused: the stream brings the chain
    // without them, and a resume still starts a clone, with the tags, the flag
    // and the description but no project or task.
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
        QCOMPARE(sendRaw("DELETE", p, auth, projectPath + QStringLiteral("/tasks/%1").arg(*p.running->taskId)).status, 200);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.state()->pause && !s.state.state()->pause->taskId, pushMs);
        QCOMPARE(s.state.state()->pause->projectId, p.running->projectId);
        QCOMPARE(sendRaw("DELETE", p, auth, projectPath).status, 200);
        QTRY_VERIFY_WITH_TIMEOUT(!s.state.state()->pause->projectId, pushMs);
        QVERIFY(s.timer.isPaused());
        QCOMPARE(s.timer.chainSeconds(), total);
        QCOMPARE(s.state.state()->pause->tags, p.running->tags);
        QVERIFY(s.state.state()->pause->billable);
        QCOMPARE(s.timer.errorString(), QString());

        const qsizetype beforeBare = s.transport.log.size();
        QVERIFY(s.timer.resume());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isRunning() && s.timer.canWrite() && s.answered(beforeBare, "POST", QStringLiteral("/timer/resume")), timeoutMs);
        QCOMPARE(s.transport.sinceApp(beforeBare, "POST", QStringLiteral("/timer/resume")).first()->response->status, 200);
        const TimeEntry bare = *s.timer.currentEntry();
        QVERIFY(bare.id != clone.id && bare.id != seeded.id);
        QVERIFY(!bare.projectId);
        QVERIFY(!bare.taskId);
        QCOMPARE(bare.description, seeded.description);
        QCOMPARE(sorted(bare.tags), p.running->tags);
        QVERIFY(bare.billable);
        QCOMPARE(s.timer.chainSeconds(), total);
        QCOMPARE(s.timer.errorString(), QString());

        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.timer.chainSeconds(), total);

        // Stop while paused discards the chain and writes no entry.
        const qsizetype beforeStop = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.timer.status(), TimerController::Ready);
        QCOMPARE(s.timer.errorString(), QString());
        QCOMPARE(s.timer.elapsedSeconds(), 0);
        QCOMPARE(s.timer.elapsedText(), QStringLiteral("0:00"));
        QCOMPARE(s.writesSince(beforeStop), QStringList{QStringLiteral("/timer/discard")});
        s.idle();
        QCOMPARE(s.writesSince(beforeStop), QStringList{QStringLiteral("/timer/discard")});
        QVERIFY(!s.timer.currentEntry());
    }

    // Another device resumes while this companion's stream is silent, so the
    // resume the companion sends carries a revision the server has left. The
    // server refuses it with 409 and the state that is there now, which the
    // companion shows: the clone the other device started. The refusal stays on
    // show through the polls that follow, the resume is never sent again, and
    // stop ends the chain.
    void resumeOnStaleRevision()
    {
        const User &q = user(QStringLiteral("a.q"));
        QVERIFY(q.running && q.running->projectId);

        Session s;
        s.signIn(q);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(q), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        const qint64 paused = s.timer.chainSeconds();
        QVERIFY(paused > 0);
        const qint64 seen = s.state.state()->revision;

        StreamStall stall(QStringLiteral("a"));
        QVERIFY(stall.active());
        const Answer other = callAs(q, "POST", QStringLiteral("/timer/resume"), {{QStringLiteral("revision"), seen}});
        QCOMPARE(other.status, 200);
        const qint64 cloneId = other.body.value(QStringLiteral("running_entry")).toObject().value(QStringLiteral("id")).toInteger();
        QVERIFY(cloneId > 0);
        QTest::qWait(500);
        QCOMPARE(s.state.state()->revision, seen); // nothing reached the companion
        QVERIFY(s.timer.isPaused());

        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.resume());
        QTRY_VERIFY_WITH_TIMEOUT(s.answered(before, "POST", QStringLiteral("/timer/resume")) && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.transport.sinceApp(before, "POST", QStringLiteral("/timer/resume")).first()->response->status, 409);
        QCOMPARE(s.state.state()->revision, other.body.value(QStringLiteral("revision")).toInteger());
        QVERIFY(s.timer.isRunning());
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.currentEntry()->id, cloneId);
        QCOMPARE(s.timer.chainSeconds(), paused);
        const QString refusal = QStringLiteral("The timer changed on another device first.");
        QCOMPARE(s.timer.errorString(), refusal);
        QCOMPARE(s.timer.status(), TimerController::Error);

        s.idle();
        QCOMPARE(s.transport.since(before, "POST").size(), 1);
        QCOMPARE(s.timer.errorString(), refusal);
        QVERIFY(s.timer.isRunning());

        // The clone belongs to the chain, so stopping it ends the chain.
        stall.release();
        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.timer.errorString(), QString());
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.chainSeconds(), 0);
        QCOMPARE(s.transport.since(before, "POST").size(), 1);
    }

    // A Pomodoro session run from the companion: Start session, Next phase
    // twice and End session. The pomodoros keep the project and billable flag
    // the session started with, every call carries the revision the companion
    // held and is answered, and nothing goes through the v9 entry calls.
    void pomodoroSessionRun()
    {
        const User &sn = user(QStringLiteral("a.sn"));
        const qint64 projectId = sn.projects.first().first;

        Session s;
        s.signIn(sn);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(sn), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        QVERIFY(s.timer.chooseProject(projectId));
        QVERIFY(s.timer.chooseBillable(true));
        QVERIFY(s.pomodoro.setPomodoroMode(true));
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.canStartSession(), timeoutMs);
        const qsizetype before = s.transport.log.size();

        QVERIFY(s.pomodoro.startSession());
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.isActive() && s.answered(before, "POST", QStringLiteral("/pomodoro")), timeoutMs);
        QCOMPARE(s.pomodoro.phase(), QStringLiteral("work"));
        QCOMPARE(s.pomodoro.pomodoroNumber(), 1);
        QCOMPARE(s.pomodoro.nextPhase(), QStringLiteral("shortRest"));
        QVERIFY(s.pomodoro.modeLocked());
        QVERIFY(s.pomodoro.remainingSeconds() > 0);
        QVERIFY(s.timer.isSessionActive());
        QVERIFY(!s.timer.isRunning()); // the open pomodoro belongs to the session
        QVERIFY(!s.timer.start());
        QVERIFY(!s.timer.pause());
        const TimerPomodoro first = *s.state.state()->pomodoro;
        const qint64 startRevision = s.state.state()->revision;
        QVERIFY(first.entryId > 0);
        QCOMPARE(first.config.workMinutes, 25);

        // Work to rest changes the session only.
        QVERIFY(s.pomodoro.confirmNextPhase());
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.phase() == QLatin1String("shortRest") && s.answered(before, "POST", QStringLiteral("/pomodoro/next")), timeoutMs);
        QCOMPARE(s.pomodoro.nextPhase(), QStringLiteral("work"));
        QCOMPARE(s.pomodoro.pomodoroNumber(), 1);
        QCOMPARE(s.state.state()->pomodoro->entryId, first.entryId);
        const qint64 restRevision = s.state.state()->revision;
        QVERIFY(restRevision > startRevision);

        // Rest to work ends the first pomodoro and starts the second.
        const qsizetype beforeSecond = s.transport.log.size();
        QVERIFY(s.pomodoro.confirmNextPhase());
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.phase() == QLatin1String("work") && s.answered(beforeSecond, "POST", QStringLiteral("/pomodoro/next")), timeoutMs);
        QCOMPARE(s.pomodoro.pomodoroNumber(), 2);
        const TimerPomodoro second = *s.state.state()->pomodoro;
        QVERIFY(second.entryId != first.entryId);
        // The first one lasted seconds: the server dropped it, and the state says so once.
        QVERIFY(s.state.state()->discardedPomodoro);
        QCOMPARE(s.state.state()->discardedPomodoro->entryId, first.entryId);
        QCOMPARE(s.pomodoro.message(), QStringLiteral("This pomodoro was too short to save."));
        const qint64 workRevision = s.state.state()->revision;
        QVERIFY(workRevision > restRevision);

        const qsizetype beforeEnd = s.transport.log.size();
        QVERIFY(s.pomodoro.endSession());
        QTRY_VERIFY_WITH_TIMEOUT(!s.pomodoro.isActive() && s.answered(beforeEnd, "POST", QStringLiteral("/pomodoro/end")), timeoutMs);
        QVERIFY(s.state.state()->revision > workRevision);
        QVERIFY(!s.state.state()->pomodoro);
        QVERIFY(!s.timer.isSessionActive());
        QVERIFY(!s.timer.isRunning());
        QVERIFY(!s.pomodoro.modeLocked());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.canWrite(), timeoutMs);
        QVERIFY(s.state.streaming());
        // The second pomodoro lasted seconds, so the server dropped it and the state says so.
        QVERIFY(s.state.state()->discardedPomodoro);
        QCOMPARE(s.state.state()->discardedPomodoro->entryId, second.entryId);
        QCOMPARE(s.pomodoro.message(), QStringLiteral("This pomodoro was too short to save."));

        // Four writes, all to the app's session calls, each answered with 200.
        QCOMPARE(s.writesSince(before),
                 (QStringList{QStringLiteral("/pomodoro"), QStringLiteral("/pomodoro/next"), QStringLiteral("/pomodoro/next"), QStringLiteral("/pomodoro/end")}));
        for (const auto &exchange : s.transport.since(before)) {
            if (isWrite(exchange->request.method)) {
                QVERIFY(exchange->response.has_value());
                QCOMPARE(exchange->response->status, 200);
            }
        }
    }

    // A session started, advanced and ended on another device shows in the
    // companion within two seconds, in Timer mode, through the stream alone:
    // the companion sends no read and no write, and the fake clock never moves,
    // so no poll could have brought it.
    void pomodoroSessionPushedByAnotherDevice()
    {
        const User &pu = user(QStringLiteral("a.pu"));

        Session s;
        s.signIn(pu);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(pu), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        QVERIFY(!s.pomodoro.pomodoroMode());
        QVERIFY(!s.pomodoro.isActive());
        const qsizetype before = s.transport.log.size();

        const Answer started = callAs(pu, "POST", QStringLiteral("/pomodoro"), {{QStringLiteral("description"), QStringLiteral("started elsewhere")}});
        QCOMPARE(started.status, 200);
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.isActive(), pushMs);
        QCOMPARE(s.pomodoro.phase(), QStringLiteral("work"));
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isSessionActive() && s.pomodoro.modeLocked(), pushMs);
        QCOMPARE(s.state.state()->revision, started.body.value(QStringLiteral("revision")).toInteger());
        QVERIFY(s.state.streaming());

        const Answer advanced = callAs(pu, "POST", QStringLiteral("/pomodoro/next"), {{QStringLiteral("revision"), s.state.state()->revision}});
        QCOMPARE(advanced.status, 200);
        QTRY_COMPARE_WITH_TIMEOUT(s.pomodoro.phase(), QStringLiteral("shortRest"), pushMs);
        QCOMPARE(s.state.state()->revision, advanced.body.value(QStringLiteral("revision")).toInteger());

        const Answer ended = callAs(pu, "POST", QStringLiteral("/pomodoro/end"), {{QStringLiteral("revision"), s.state.state()->revision}});
        QCOMPARE(ended.status, 200);
        QTRY_VERIFY_WITH_TIMEOUT(!s.pomodoro.isActive() && !s.timer.isSessionActive(), pushMs);
        QCOMPARE(s.state.state()->revision, ended.body.value(QStringLiteral("revision")).toInteger());

        QVERIFY(s.state.streaming());
        QVERIFY(s.writesSince(before).isEmpty());
        QVERIFY(s.transport.sinceApp(before, "GET", QStringLiteral("/timer")).isEmpty());
    }

    // Pause, resume, pause again and discard with Stop. The chain total is what
    // the server stored: the hour the seeded entry ran, and nothing for the
    // clone, which stopped seconds after it started. Each action is the
    // server's timer action, and no v9 call writes.
    void pauseResumeAndDiscard()
    {
        const User &pc = user(QStringLiteral("a.pc"));
        QVERIFY(pc.running && pc.running->projectId && pc.running->billable);

        Session s;
        s.signIn(pc);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(pc), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        const TimeEntry seeded = *s.timer.currentEntry();
        QCOMPARE(seeded.id, pc.running->id);
        const qsizetype before = s.transport.log.size();

        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite() && s.answered(before, "POST", QStringLiteral("/timer/pause")), timeoutMs);
        QVERIFY(!s.timer.currentEntry());
        const qint64 paused = s.timer.chainSeconds();
        QVERIFY2(paused > 0 && paused % resolutionSeconds == 0, qPrintable(QString::number(paused)));
        QVERIFY(paused >= 3500 && paused <= 2 * 3600); // the hour the entry ran, and the minutes since the fixture

        QVERIFY(s.timer.resume());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isRunning() && s.timer.canWrite() && s.answered(before, "POST", QStringLiteral("/timer/resume")), timeoutMs);
        const TimeEntry clone = *s.timer.currentEntry();
        QVERIFY(clone.id != seeded.id);
        QCOMPARE(clone.description, seeded.description);
        QCOMPARE(clone.projectId, seeded.projectId);
        QVERIFY(clone.billable);
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.chainSeconds(), paused);

        const qsizetype beforeSecondPause = s.transport.log.size();
        QVERIFY(s.timer.pause());
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.isPaused() && s.timer.canWrite() && s.answered(beforeSecondPause, "POST", QStringLiteral("/timer/pause")), timeoutMs);
        QCOMPARE(s.timer.chainSeconds(), paused); // the clone was too short to store
        QCOMPARE(s.timer.elapsedText(), hoursAndMinutes(paused));

        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isPaused() && s.timer.canWrite() && s.answered(before, "POST", QStringLiteral("/timer/discard")), timeoutMs);
        QVERIFY(!s.timer.isRunning());
        QVERIFY(!s.timer.currentEntry());
        QCOMPARE(s.timer.chainSeconds(), 0);
        QCOMPARE(s.timer.elapsedText(), QStringLiteral("0:00"));
        QCOMPARE(s.timer.errorString(), QString());
        QCOMPARE(s.timer.status(), TimerController::Ready);
        QVERIFY(!s.state.state()->pause);
        QVERIFY(!s.state.state()->runningEntry);

        QCOMPARE(s.writesSince(before),
                 (QStringList{QStringLiteral("/timer/pause"), QStringLiteral("/timer/resume"), QStringLiteral("/timer/pause"), QStringLiteral("/timer/discard")}));
        for (const auto &exchange : s.transport.since(before)) {
            if (isWrite(exchange->request.method)) {
                QCOMPARE(exchange->response->status, 200);
            }
        }
    }

    // The proxy keeps the reply to a pause back and cuts it off. The server has
    // paused, and the stream says so while the reply is held, but the
    // companion does not know the outcome of its write: it never sends the
    // pause again, reads the state, and that read settles the result.
    void lostPauseReply()
    {
        const User &hd = user(QStringLiteral("a.hd"));
        QVERIFY(hd.running);

        Session s;
        s.signIn(hd);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(hd), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, hd.running->id);

        QVERIFY(holdApp(QStringLiteral("a"), "POST", QStringLiteral("/timer/pause")));
        const int pausesBefore = requestsSeen(QStringLiteral("a"), "POST", QStringLiteral("/timer/pause"));
        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.pause());
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.state()->pause && s.state.state()->pause->paused, pushMs);
        QVERIFY(!s.answered(before, "POST", QStringLiteral("/timer/pause")));
        QVERIFY(s.timer.isBusy());

        QVERIFY(dropHeld(QStringLiteral("a")));
        QCOMPARE(heldReplies(QStringLiteral("a")), 0);
        const auto pauses = s.transport.sinceApp(before, "POST", QStringLiteral("/timer/pause"));
        QCOMPARE(pauses.size(), 1);
        QTRY_VERIFY_WITH_TIMEOUT(pauses.first()->response.has_value(), timeoutMs);
        // What came back is the head of a reply and part of its body: nothing the companion can read.
        QVERIFY(!QJsonDocument::fromJson(pauses.first()->response->body).isObject());

        // A read sent after the lost reply brings the state and ends the wait.
        QTRY_VERIFY_WITH_TIMEOUT(!s.state.settling() && s.timer.canWrite(), timeoutMs);
        const qsizetype pausedAt = s.transport.log.indexOf(pauses.first());
        bool readAfter = false;
        for (qsizetype i = pausedAt + 1; i < s.transport.log.size(); ++i) {
            const auto &exchange = s.transport.log.at(i);
            if (exchange->request.method == "GET" && exchange->request.url.path().endsWith(QStringLiteral("/api/app/timer"))
                && exchange->response && exchange->response->outcome == HttpResponse::Outcome::Finished && exchange->response->status == 200) {
                readAfter = true;
            }
        }
        QVERIFY(readAfter);
        QVERIFY(s.timer.isPaused());
        QVERIFY(!s.timer.isRunning());
        QVERIFY(s.timer.chainSeconds() > 0);
        QCOMPARE(s.timer.errorString(), QString());
        QCOMPARE(s.timer.status(), TimerController::Ready);

        // Nothing sends the pause again, however long it takes: the proxy
        // received one, whatever the companion's own log says.
        s.idle();
        QCOMPARE(s.writesSince(before), QStringList{QStringLiteral("/timer/pause")});
        QCOMPARE(requestsSeen(QStringLiteral("a"), "POST", QStringLiteral("/timer/pause")) - pausesBefore, 1);
        QVERIFY(s.timer.isPaused());

        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isPaused() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.writesSince(before), (QStringList{QStringLiteral("/timer/pause"), QStringLiteral("/timer/discard")}));
    }

    void cleanupTestCase()
    {
        QCOMPARE(heldReplies(QStringLiteral("a")), 0);
        QCOMPARE(heldReplies(QStringLiteral("b")), 0);
    }
};

QTEST_GUILESS_MAIN(RealServerTest)

#include "realservertest.moc"
