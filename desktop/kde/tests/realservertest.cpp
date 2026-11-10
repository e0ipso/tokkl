// Run through realserver.test.ts, which starts the servers and proxies and
// checks the servers' data after this binary exits.

#include "apitypes.h"
#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstack.h"
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

#include <algorithm>
#include <memory>
#include <optional>

using namespace Tokkl;

namespace
{
constexpr int timeoutMs = 15000;
constexpr int quietMs = 2000;
constexpr qint64 resolutionSeconds = 60;
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

struct Exchange {
    HttpRequest request;
    std::optional<HttpResponse> response;
};

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

    PendingStream *openStream(const HttpRequest &request) override
    {
        return m_inner.openStream(request);
    }

    // The path suffix is after `api`, query excluded.
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

    QList<std::shared_ptr<Exchange>> sinceApp(qsizetype from, const QByteArray &method = {}, const QString &path = {}) const
    {
        return since(from, method, path, QStringLiteral("/api/app"));
    }

    bool settled() const
    {
        return std::all_of(log.cbegin(), log.cend(), [](const auto &exchange) {
            return exchange->response.has_value();
        });
    }

    QList<std::shared_ptr<Exchange>> log;

private:
    NetworkTransport m_inner{QStringLiteral("tokkl-kde")};
};

bool isWrite(const QByteArray &method)
{
    return method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE";
}

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

// realserver.test.ts checks the widget's client name in created_with.
struct Session {
    FakeCredentialStore store;
    RecordingTransport transport;
    FakeClock clock;
    MemoryPomodoroStore pomodoroStore;
    TimerStack stack{&transport, &store, pomodoroStore, clock, QStringLiteral("tokkl-kde")};
    Connection &connection{*stack.connection()};
    TimerController &timer{*stack.timer()};
    TimerStateClient &state{*timer.stateClient()};
    PomodoroSession &pomodoro{*stack.session()};

    Session()
    {
        clock.current = QDateTime::currentDateTimeUtc();
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

    void replaceToken(const User &user)
    {
        bool written = false;
        store.write(keyFor(user, AuthMode::Token), user.token, &store, [&written](const CredentialResult &) {
            written = true;
        });
        QTRY_VERIFY_WITH_TIMEOUT(written, timeoutMs);
    }

    // Steps stay shorter than the tick gap the state client reads as a wake
    // from sleep, which would replace the stream.
    void idle()
    {
        const int step = TimerStateClient::resumeGapMs / 2;
        for (int passed = 0; passed < 4 * TimerStateClient::pollIntervalMs; passed += step) {
            clock.advance(step);
        }
        QTest::qWait(quietMs);
    }

    // A state from the stream may come first.
    bool answered(qsizetype from, const QByteArray &method, const QString &path) const
    {
        const auto found = transport.sinceApp(from, method, path);
        return !found.isEmpty() && found.last()->response.has_value();
    }

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
        const QVariantList shown = timer.projects();
        for (const QVariant &value : shown) {
            const QVariantMap project = value.toMap();
            list.append({project.value(QStringLiteral("id")).toLongLong(), project.value(QStringLiteral("name")).toString()});
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

// Counted at the proxy, whatever the companion logged.
int requestsSeen(const QString &instance, const QByteArray &method, const QString &path)
{
    const auto answer = control(QStringLiteral("/seen"),
                                {{QStringLiteral("instance"), instance},
                                 {QStringLiteral("method"), QString::fromLatin1(method)},
                                 {QStringLiteral("path"), QString(QStringLiteral("/api/app") + path)}});
    return answer ? answer->value(QStringLiteral("seen")).toInt() : -1;
}

// A connection closed before the first reply byte would make Qt resend
// the request by itself.
bool dropHeld(const QString &instance)
{
    const auto answer = control(QStringLiteral("/drop"), {{QStringLiteral("instance"), instance}});
    return answer && answer->value(QStringLiteral("dropped")).toInt() > 0;
}

// Another device of the same account; the proxy never sees it.
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

    HttpResponse unknownTokenAnswer(const User &anyone)
    {
        return sendRaw("GET", anyone, basicAuthorization(AuthMode::Token, QString(), QStringLiteral("0000000000000000000000000000dead")), QStringLiteral("/me"));
    }

    void checkRefusedAndQuiet(Session &s)
    {
        QCOMPARE(s.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(!s.connection.account());
        QCOMPARE(s.connection.workspaceId(), 0);
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

        // The refusal ended the generation, so the server's announcement is read
        // first.
        s.connection.reconnect();
        QTRY_COMPARE_WITH_TIMEOUT(s.transport.since(before).size(), 2, timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.transport.since(before).last()->response.has_value(), timeoutMs);
        QCOMPARE(s.transport.sinceApp(before, "GET", QStringLiteral("/status")).size(), 1);
        QCOMPARE(s.transport.since(before).first()->response->status, 200);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);
        QCOMPARE(s.transport.since(before).last()->response->status, 403);
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        s.idle();
        QCOMPARE(s.transport.log.size(), before + 2);
    }

private Q_SLOTS:
    void initTestCase()
    {
        QString error;
        QVERIFY2(loadFixture(&error), qPrintable(error));
        QVERIFY(heldReplies(QStringLiteral("a")) == 0);
    }

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

        const QByteArray auth = tokenAuthorization(u);
        const QString foreign = QStringLiteral("/workspaces/%1/time_entries").arg(admin.workspaceId);
        const QList<std::tuple<QByteArray, QString, QByteArray>> attempts = {
            {"POST", foreign, QJsonDocument(QJsonObject{
                                  {QStringLiteral("workspace_id"), admin.workspaceId},
                                  {QStringLiteral("start"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate)},
                                  {QStringLiteral("duration"), -1},
                                  {QStringLiteral("created_with"), QStringLiteral("tokkl-kde")},
                              }).toJson(QJsonDocument::Compact)},
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

    void userSwitchWithLateReplies()
    {
        const User &admin = user(QStringLiteral("a.admin"));
        const User &u = user(QStringLiteral("a.u"));

        Session s;
        s.signIn(admin);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(admin), timeoutMs);
        QCOMPARE(s.timer.currentEntry()->id, admin.running->id);

        QVERIFY(holdApp(QStringLiteral("a"), "GET", QStringLiteral("/timer")));
        s.state.refresh();
        s.timer.refreshProjects();
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

        const qsizetype beforeStart = s.transport.log.size();
        QVERIFY(holdApp(QStringLiteral("a"), "POST", QStringLiteral("/timer/start")));
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
        s.state.refresh();
        s.timer.refreshProjects();
        QTRY_COMPARE_WITH_TIMEOUT(heldReplies(QStringLiteral("a")), 1, timeoutMs);
        const qsizetype switchedAt = s.transport.log.size();
        s.signIn(b);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(b), timeoutMs);
        QVERIFY(release(QStringLiteral("a")));
        QTest::qWait(500);

        QVERIFY(s.ready(b));
        QCOMPARE(s.transport.sinceApp(switchedAt, "GET", QStringLiteral("/status")).size(), 1);
        QVERIFY(s.connection.server().capabilities.contains(QStringLiteral("timer-actions")));
        QCOMPARE(s.timer.currentEntry()->id, b.running->id);
        QCOMPARE(s.timer.currentEntry()->description, b.running->description);
        QCOMPARE(s.timer.currentEntry()->start, b.running->start);

        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        const QString bOrigin = QUrl(b.url).authority();
        for (const auto &exchange : s.transport.since(switchedAt)) {
            QCOMPARE(exchange->request.url.authority(), bOrigin);
        }
        QCOMPARE(s.transport.sinceApp(switchedAt, "POST", QStringLiteral("/timer/stop")).size(), 1);
    }

    // A stop would not show the loss: /api/app/timer/stop checks only that the
    // workspace exists.
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
        s.state.refresh();
        s.timer.refreshProjects();
        QTRY_VERIFY_WITH_TIMEOUT(s.timer.workspaceAccessLost(), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(!s.transport.since(before, "GET", QStringLiteral("/me")).isEmpty()
                                     && s.transport.since(before, "GET", QStringLiteral("/me")).first()->response,
                                 timeoutMs);
        s.idle();

        s.idle();

        const auto reads = s.transport.sinceApp(before, "GET", QStringLiteral("/workspaces/%1/catalog").arg(m.workspaceId));
        QCOMPARE(reads.size(), 1);
        QCOMPARE(reads.first()->response->status, 403);
        QVERIFY(s.transport.since(before, "GET", QStringLiteral("/workspaces/%1/projects").arg(m.workspaceId)).isEmpty());
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);
        QCOMPARE(s.transport.sinceApp(before, "GET", QStringLiteral("/timer")).size(), 1);
        QVERIFY2(s.transport.since(before).size() == 3, qPrintable(describe(s.transport.since(before))));
        QCOMPARE(s.connection.state(), Connection::Connected);
        QVERIFY(s.timer.workspaceAccessLost());
        QVERIFY(!s.timer.canWrite());
        QVERIFY(!s.timer.currentEntry());
        QVERIFY(s.timer.projects().isEmpty());
        QVERIFY(!s.timer.start());
        QCOMPARE(s.transport.since(before).size(), 3);
    }

    // The stop's 403 alone is not taken as refused credentials; /me's is.
    void disabledTokenDuringWrite()
    {
        const User &dt = user(QStringLiteral("a.dt"));
        QVERIFY(dt.running);

        Session s;
        s.signIn(dt);
        QTRY_VERIFY_WITH_TIMEOUT(s.ready(dt), timeoutMs);
        QTRY_VERIFY_WITH_TIMEOUT(s.state.streaming(), timeoutMs);
        // A read still on its way when the account is disabled would be the
        // first request refused.
        QTRY_VERIFY_WITH_TIMEOUT(s.transport.settled(), timeoutMs);
        // The stream goes silent first, so the stop is the first request refused.
        StreamStall stall(QStringLiteral("a"));
        QVERIFY(stall.active());
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dt.key}}));

        const qsizetype before = s.transport.log.size();
        QVERIFY(s.timer.stop());
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        const auto all = s.transport.since(before);
        QVERIFY2(all.size() == 2, qPrintable(describe(all)));
        QVERIFY(all.at(0)->request.url.path().endsWith(QStringLiteral("/api/app/timer/stop")));
        QCOMPARE(all.at(0)->response->status, 403);
        QCOMPARE(s.transport.since(before, "GET", QStringLiteral("/me")).size(), 1);

        const HttpResponse unknown = unknownTokenAnswer(dt);
        QCOMPARE(all.at(1)->response->status, 403);
        QCOMPARE(unknown.status, 403);
        QCOMPARE(all.at(1)->response->body, unknown.body);
        QCOMPARE(all.at(0)->response->body, unknown.body);

        checkRefusedAndQuiet(s);
    }

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
        QTRY_VERIFY_WITH_TIMEOUT(s.transport.settled(), timeoutMs);
        StreamStall stall(QStringLiteral("a"));
        QVERIFY(stall.active());
        QVERIFY(control(QStringLiteral("/disable"), {{QStringLiteral("user"), dp.key}}));

        const qsizetype before = s.transport.log.size();
        s.state.refresh();
        s.timer.refreshProjects();
        QTRY_COMPARE_WITH_TIMEOUT(s.connection.state(), Connection::AuthenticationFailed, timeoutMs);
        QTest::qWait(500);
        // The catalog read may be refused first and trigger one /me.
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

    // Another device resumes while this stream is silent, so the resume
    // carries a revision the server has left.
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

        stall.release();
        QVERIFY(s.timer.stop());
        QTRY_VERIFY_WITH_TIMEOUT(!s.timer.isRunning() && s.timer.canWrite(), timeoutMs);
        QCOMPARE(s.timer.errorString(), QString());
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.chainSeconds(), 0);
        QCOMPARE(s.transport.sinceApp(before, "POST", QStringLiteral("/timer/resume")).size(), 1);
        QCOMPARE(s.transport.sinceApp(before, "POST", QStringLiteral("/timer/stop")).size(), 1);
    }

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

        QVERIFY(s.pomodoro.confirmNextPhase());
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.phase() == QLatin1String("shortRest") && s.answered(before, "POST", QStringLiteral("/pomodoro/next")), timeoutMs);
        QCOMPARE(s.pomodoro.nextPhase(), QStringLiteral("work"));
        QCOMPARE(s.pomodoro.pomodoroNumber(), 1);
        QCOMPARE(s.state.state()->pomodoro->entryId, first.entryId);
        const qint64 restRevision = s.state.state()->revision;
        QVERIFY(restRevision > startRevision);

        const qsizetype beforeSecond = s.transport.log.size();
        QVERIFY(s.pomodoro.confirmNextPhase());
        QTRY_VERIFY_WITH_TIMEOUT(s.pomodoro.phase() == QLatin1String("work") && s.answered(beforeSecond, "POST", QStringLiteral("/pomodoro/next")), timeoutMs);
        QCOMPARE(s.pomodoro.pomodoroNumber(), 2);
        const TimerPomodoro second = *s.state.state()->pomodoro;
        QVERIFY(second.entryId != first.entryId);
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
        QVERIFY(s.state.state()->discardedPomodoro);
        QCOMPARE(s.state.state()->discardedPomodoro->entryId, second.entryId);
        QCOMPARE(s.pomodoro.message(), QStringLiteral("This pomodoro was too short to save."));

        QCOMPARE(s.writesSince(before),
                 (QStringList{QStringLiteral("/pomodoro"), QStringLiteral("/pomodoro/next"), QStringLiteral("/pomodoro/next"), QStringLiteral("/pomodoro/end")}));
        for (const auto &exchange : s.transport.since(before)) {
            if (isWrite(exchange->request.method)) {
                QVERIFY(exchange->response.has_value());
                QCOMPARE(exchange->response->status, 200);
            }
        }
    }

    // The fake clock never moves, so only the stream can bring the session.
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

    // The server has paused, but the companion does not know the outcome of
    // its write.
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
        QVERIFY(!QJsonDocument::fromJson(pauses.first()->response->body).isObject());

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
