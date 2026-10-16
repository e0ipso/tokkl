// The connection state machine and the Configure page helper, driven through
// a scripted transport and credential store.

#include "connection.h"
#include "connectionsetup.h"
#include "fakes.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://example.test/tokkl");
const QString token = QStringLiteral("tok-7f3a9c");
const QString password = QStringLiteral("hunter2-pw");

QByteArray meBody(qint64 id, qint64 workspace, const QString &email = QStringLiteral("bea@example.test"))
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("api_token"), token},
                             {QStringLiteral("email"), email},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), QStringLiteral("UTC")},
                             {QStringLiteral("default_workspace_id"), workspace},
                             {QStringLiteral("beginning_of_week"), 1},
                         })
        .toJson(QJsonDocument::Compact);
}

QByteArray entryBody(qint64 id, qint64 workspace, bool running = true)
{
    QJsonObject entry{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), workspace},
        {QStringLiteral("project_id"), QJsonValue::Null},
        {QStringLiteral("billable"), false},
        {QStringLiteral("start"), QStringLiteral("2026-10-16T08:00:00+00:00")},
        {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(QStringLiteral("2026-10-16T09:00:00+00:00"))},
        {QStringLiteral("duration"), running ? -1792137600 : 3600},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
    return QJsonDocument(entry).toJson(QJsonDocument::Compact);
}

QByteArray projectsBody(qint64 workspace)
{
    return QStringLiteral(R"([{"id":11,"workspace_id":%1,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])")
        .arg(workspace)
        .toUtf8();
}

QString path(const HttpRequest &request)
{
    return request.url.path() + (request.url.hasQuery() ? QLatin1Char('?') + request.url.query() : QString());
}

// Everything Qt logs while a test runs, to prove secrets never reach a log.
QStringList logLines;
QtMessageHandler previousHandler = nullptr;
void captureLog(QtMsgType type, const QMessageLogContext &context, const QString &message)
{
    logLines.append(message);
    previousHandler(type, context, message);
}
}

class ConnectionTest : public QObject
{
    Q_OBJECT

    // A connection with its fakes, connected as a validated account.
    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        Connection connection{&transport, &store};
    };

    static QString tokenKey(const QString &url = instance)
    {
        return credentialKey(parseInstanceUrl(url), AuthMode::Token, QString());
    }

    static QString passwordKey(const QString &email, const QString &url = instance)
    {
        return credentialKey(parseInstanceUrl(url), AuthMode::Password, email);
    }

    // Configure token auth and answer /me with the given workspace.
    static bool connectAccount(Fixture &f, qint64 userId = 3, qint64 workspace = 7)
    {
        f.store.secrets.insert(tokenKey(), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(instance);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.transport.respondLast(FakeTransport::answer(200, meBody(userId, workspace)));
        return f.connection.state() == Connection::Connected;
    }

    // Fill every piece of account data and next-start choice.
    static bool populate(Fixture &f)
    {
        f.connection.fetchProjects();
        f.transport.respondLast(FakeTransport::answer(200, projectsBody(f.connection.workspaceId())));
        f.connection.fetchCurrentEntry();
        f.transport.respondLast(FakeTransport::answer(200, entryBody(5, f.connection.workspaceId())));
        f.connection.setNextProjectId(11);
        f.connection.setNextBillable(true);
        return f.connection.projects().size() == 1 && f.connection.currentEntry().has_value();
    }

    static void verifyCleared(const Connection &connection)
    {
        QVERIFY(!connection.isConnected());
        QVERIFY(!connection.canWrite());
        QVERIFY(!connection.account().has_value());
        QCOMPARE(connection.workspaceId(), 0);
        QVERIFY(connection.accountMap().isEmpty());
        QVERIFY(connection.projects().isEmpty());
        QVERIFY(!connection.currentEntry().has_value());
        QVERIFY(connection.currentEntryVariant().isNull());
        QVERIFY(!connection.nextProjectId().has_value());
        QVERIFY(!connection.nextBillable());
    }

private Q_SLOTS:
    void initTestCase()
    {
        previousHandler = qInstallMessageHandler(captureLog);
    }

    void cleanupTestCase()
    {
        qInstallMessageHandler(previousHandler);
        // No secret or Basic credential was logged by any test.
        const QByteArray basic = basicAuthorization(AuthMode::Token, QString(), token);
        for (const QString &line : std::as_const(logLines)) {
            QVERIFY2(!line.contains(token) && !line.contains(password) && !line.contains(QString::fromLatin1(basic.mid(6))), qPrintable(line));
        }
    }

    void startsUnconfigured()
    {
        Fixture f;
        QCOMPARE(f.connection.instanceUrl(), QString());
        QCOMPARE(f.connection.authModeString(), QStringLiteral("token"));
        QCOMPARE(f.connection.state(), Connection::Unconfigured);
        QTest::qWait(10);
        // A blank address never opens the wallet or the network.
        QCOMPARE(f.store.reads, 0);
        QVERIFY(f.transport.requests.isEmpty());
    }

    void invalidSettings()
    {
        Fixture f;
        f.connection.setInstanceUrl(QStringLiteral("tokkl.example.test"));
        QTRY_COMPARE(f.connection.state(), Connection::InvalidSettings);
        QVERIFY(!f.connection.errorString().isEmpty());

        f.connection.setInstanceUrl(instance);
        f.connection.setAuthModeString(QStringLiteral("password"));
        QTRY_COMPARE(f.connection.state(), Connection::InvalidSettings);
        QCOMPARE(f.store.reads, 0);
        QVERIFY(f.transport.requests.isEmpty());
    }

    void tokenAuth()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const HttpRequest &request = f.transport.requests.first();
        QCOMPARE(request.method, QByteArray("GET"));
        QCOMPARE(request.url.toString(), QStringLiteral("https://example.test/tokkl/api/v9/me"));
        QCOMPARE(request.authorization, QByteArray("Basic ") + (token + QStringLiteral(":api_token")).toUtf8().toBase64());
        QVERIFY(!request.authorization.startsWith("Bearer"));
        QVERIFY(request.url.userInfo().isEmpty());
        QVERIFY(!request.url.toString().contains(token));
    }

    void passwordAuth()
    {
        Fixture f;
        f.store.secrets.insert(passwordKey(QStringLiteral("bea@example.test")), password);
        f.connection.setAuthModeString(QStringLiteral("password"));
        f.connection.setEmail(QStringLiteral("Bea@example.test"));
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        // The three settings changed in one go: one wallet read.
        QCOMPARE(f.store.reads, 1);
        QCOMPARE(f.transport.requests.first().authorization, QByteArray("Basic ") + QByteArray("Bea@example.test:hunter2-pw").toBase64());
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.connection.account()->email, QStringLiteral("bea@example.test"));
    }

    void discoveredWorkspaceScopesEveryOperation()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 42));
        QCOMPARE(f.connection.workspaceId(), 42);
        QCOMPARE(f.connection.accountMap().value(QStringLiteral("defaultWorkspaceId")).toLongLong(), 42);

        f.connection.fetchProjects();
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects?active=true"));
        f.transport.respondLast(FakeTransport::answer(200, projectsBody(42)));
        QCOMPARE(f.connection.projectList().size(), 1);

        StartEntry start;
        start.start = QDateTime::currentDateTimeUtc();
        start.projectId = 11;
        f.connection.startEntry(start);
        const HttpRequest post = f.transport.requests.last();
        QCOMPARE(post.method, QByteArray("POST"));
        QCOMPARE(path(post), QStringLiteral("/tokkl/api/v9/workspaces/42/time_entries"));
        QCOMPARE(QJsonDocument::fromJson(post.body).object().value(QLatin1String("workspace_id")).toInteger(), 42);
        f.transport.respondLast(FakeTransport::answer(200, entryBody(5, 42)));
        QCOMPARE(f.connection.currentEntry()->id, 5);

        TimeEntryUpdate update;
        update.description = QStringLiteral("Deep work");
        f.connection.updateEntry(5, update);
        QCOMPARE(f.transport.requests.last().method, QByteArray("PUT"));
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/time_entries/5"));
        f.transport.respondLast(FakeTransport::answer(200, entryBody(5, 42)));

        f.connection.stopEntry(5);
        QCOMPARE(f.transport.requests.last().method, QByteArray("PATCH"));
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/time_entries/5/stop"));
        f.transport.respondLast(FakeTransport::answer(200, entryBody(5, 42, false)));
        QVERIFY(!f.connection.currentEntry().has_value());

        for (const HttpRequest &request : std::as_const(f.transport.requests)) {
            QVERIFY2(!path(request).contains(QLatin1String("/workspaces/1/")), qPrintable(path(request)));
        }
    }

    void typedResults()
    {
        Fixture f;
        QVERIFY(connectAccount(f));

        std::optional<ApiResult<std::optional<TimeEntry>>> current;
        f.connection.fetchCurrentEntry([&](const auto &result) {
            current = result;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me/time_entries/current"));
        f.transport.respondLast(FakeTransport::answer(200, "null"));
        QVERIFY(current && current->ok());
        QVERIFY(!current->value->has_value());

        std::optional<ApiResult<Me>> me;
        f.connection.fetchMe([&](const auto &result) {
            me = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(me && me->ok());
        QCOMPARE(me->value->defaultWorkspaceId, 7);

        std::optional<ApiResult<TimeEntry>> stopped;
        f.connection.stopEntry(99, [&](const auto &result) {
            stopped = result;
        });
        f.transport.respondLast(FakeTransport::answer(404, "\"Time entry not found\""));
        QVERIFY(stopped && !stopped->ok());
        QVERIFY(stopped->error.kind == ApiError::Kind::Client);
        QCOMPARE(stopped->error.message, QStringLiteral("Time entry not found"));

        std::optional<ApiResult<QList<Project>>> projects;
        f.connection.fetchProjects([&](const auto &result) {
            projects = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, "{\"not\":\"an array\"}"));
        QVERIFY(projects && !projects->ok());
        QVERIFY(projects->error.kind == ApiError::Kind::InvalidResponse);
        QCOMPARE(f.connection.state(), Connection::Connected);
    }

    void operationsNeedAnAccount()
    {
        Fixture f;
        std::optional<ApiResult<TimeEntry>> result;
        StartEntry start;
        start.start = QDateTime::currentDateTimeUtc();
        f.connection.startEntry(start, [&](const auto &r) {
            result = r;
        });
        QTRY_VERIFY(result.has_value());
        QVERIFY(result->error.kind == ApiError::Kind::NotConnected);
        QVERIFY(f.transport.requests.isEmpty());
    }

    void walletFailures_data()
    {
        QTest::addColumn<int>("status");
        QTest::addColumn<int>("state");
        QTest::addColumn<QString>("phrase");
        QTest::newRow("locked or denied") << int(CredentialResult::Status::Unavailable) << int(Connection::WalletError) << QStringLiteral("locked or denied");
        QTest::newRow("disabled") << int(CredentialResult::Status::Disabled) << int(Connection::WalletError) << QStringLiteral("disabled");
        QTest::newRow("read failure") << int(CredentialResult::Status::Failed) << int(Connection::WalletError) << QStringLiteral("could not");
        QTest::newRow("nothing saved") << int(CredentialResult::Status::NotFound) << int(Connection::CredentialsMissing) << QStringLiteral("No credentials");
    }

    void walletFailures()
    {
        QFETCH(int, status);
        QFETCH(int, state);
        QFETCH(QString, phrase);
        Fixture f;
        f.store.failure = CredentialResult::Status(status);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(int(f.connection.state()), state);
        QVERIFY2(f.connection.errorString().contains(phrase, Qt::CaseInsensitive), qPrintable(f.connection.errorString()));
        QVERIFY(f.transport.requests.isEmpty());
        QVERIFY(!f.connection.isConnected());
    }

    void walletFailureAfterConnectClearsAccount()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        f.store.failure = CredentialResult::Status::Unavailable;
        f.connection.reconnect();
        QTRY_COMPARE(f.connection.state(), Connection::WalletError);
        verifyCleared(f.connection);
    }

    void meForbiddenPausesAuthentication()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        QSignalSpy accountChanged(&f.connection, &Connection::accountChanged);

        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QLatin1String("Incorrect username and/or password")));
        // A generic 403 does not establish that the account is disabled.
        QVERIFY(!f.connection.errorString().contains(QLatin1String("disabled"), Qt::CaseInsensitive));
        verifyCleared(f.connection);
        QVERIFY(accountChanged.count() >= 1);

        // Writes are blocked and automatic retries do nothing.
        const qsizetype sent = f.transport.requests.size();
        std::optional<ApiResult<TimeEntry>> write;
        f.connection.stopEntry(5, [&](const auto &r) {
            write = r;
        });
        QTRY_VERIFY(write.has_value());
        QVERIFY(write->error.kind == ApiError::Kind::AuthenticationPaused);
        f.connection.refreshAccount();
        QTest::qWait(20);
        QCOMPARE(f.transport.requests.size(), sent);

        // The wallet keeps the secret for correction.
        QCOMPARE(f.store.secrets.value(tokenKey()), token);
        QCOMPARE(f.store.writes, 0);

        // An explicit reconnect validates again.
        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
    }

    void configurationChangeEndsThePause()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);

        const QString other = QStringLiteral("https://other.example.test");
        f.store.secrets.insert(tokenKey(other), QStringLiteral("other-token"));
        const qsizetype sent = f.transport.requests.size();
        f.connection.setInstanceUrl(other);
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        QCOMPARE(f.transport.requests.last().url.host(), QStringLiteral("other.example.test"));
    }

    void workspaceForbiddenIsLeftToTheCaller()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        std::optional<ApiResult<QList<Project>>> result;
        f.connection.fetchProjects([&](const auto &r) {
            result = r;
        });
        f.transport.respondLast(FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(result && result->error.kind == ApiError::Kind::Forbidden);
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.isConnected());
    }

    void rateLimitCooldown()
    {
        Fixture f;
        f.store.secrets.insert(passwordKey(QStringLiteral("bea@example.test")), password);
        f.connection.setAuthModeString(QStringLiteral("password"));
        f.connection.setEmail(QStringLiteral("bea@example.test"));
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(429, "\"Too many failed login attempts, try again later\"", "1"));
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        QVERIFY(f.connection.rateLimitedUntil().isValid());
        QVERIFY(f.connection.errorString().contains(QLatin1String("Too many")));
        QVERIFY(!f.connection.canWrite());

        // Nothing is sent during the cooldown, even on explicit reconnect.
        f.connection.refreshAccount();
        f.connection.reconnect();
        QTest::qWait(300);
        QCOMPARE(f.transport.requests.size(), 1);

        // Afterwards the connection validates again by itself.
        QTRY_COMPARE_WITH_TIMEOUT(f.transport.requests.size(), 2, 3000);
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(!f.connection.rateLimitedUntil().isValid());
    }

    void rateLimitWithoutRetryAfter()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        std::optional<ApiResult<QList<Project>>> limited;
        f.connection.fetchProjects([&](const auto &r) {
            limited = r;
        });
        f.transport.respondLast(FakeTransport::answer(429, "\"Too many failed login attempts, try again later\""));
        QVERIFY(limited && limited->error.kind == ApiError::Kind::RateLimited);
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        // The account stays; only requests wait.
        QVERIFY(f.connection.isConnected());
        QVERIFY(!f.connection.canWrite());
        const qint64 wait = QDateTime::currentDateTimeUtc().msecsTo(f.connection.rateLimitedUntil());
        QVERIFY2(wait > Connection::defaultCooldownMs - 5000 && wait <= Connection::defaultCooldownMs, qPrintable(QString::number(wait)));

        const qsizetype sent = f.transport.requests.size();
        std::optional<ApiResult<std::optional<TimeEntry>>> refused;
        f.connection.fetchCurrentEntry([&](const auto &r) {
            refused = r;
        });
        QTRY_VERIFY(refused.has_value());
        QVERIFY(refused->error.kind == ApiError::Kind::RateLimited);
        QCOMPARE(f.transport.requests.size(), sent);
    }

    void transientFailuresAreNotAuthenticationFailures_data()
    {
        QTest::addColumn<int>("outcome");
        QTest::addColumn<int>("status");
        QTest::newRow("connection refused") << int(HttpResponse::Outcome::NetworkError) << 0;
        QTest::newRow("timeout") << int(HttpResponse::Outcome::Timeout) << 0;
        QTest::newRow("502") << int(HttpResponse::Outcome::Finished) << 502;
        QTest::newRow("503") << int(HttpResponse::Outcome::Finished) << 503;
    }

    void transientFailuresAreNotAuthenticationFailures()
    {
        QFETCH(int, outcome);
        QFETCH(int, status);
        HttpResponse response = FakeTransport::failure(HttpResponse::Outcome(outcome), QStringLiteral("Connection refused"));
        response.status = status;

        // Before any account is bound: disconnected, not failed, and nothing paused.
        {
            Fixture f;
            f.store.secrets.insert(tokenKey(), token);
            f.connection.setInstanceUrl(instance);
            QTRY_COMPARE(f.transport.requests.size(), 1);
            f.transport.respondLast(response);
            QCOMPARE(f.connection.state(), Connection::Disconnected);
            QVERIFY(!f.connection.isConnected());
            QVERIFY(!f.connection.errorString().isEmpty());
            f.connection.refreshAccount();
            QCOMPARE(f.transport.requests.size(), 2);
        }

        // With a bound account: the data stays, marked stale, and writes may still try.
        {
            Fixture f;
            QVERIFY(connectAccount(f));
            QVERIFY(populate(f));
            f.connection.fetchCurrentEntry();
            f.transport.respondLast(response);
            QCOMPARE(f.connection.state(), Connection::Disconnected);
            QVERIFY(f.connection.isStale());
            QVERIFY(f.connection.isConnected());
            QVERIFY(f.connection.canWrite());
            QCOMPARE(f.connection.currentEntry()->id, 5);
            QCOMPARE(f.connection.projects().size(), 1);

            f.connection.fetchCurrentEntry();
            f.transport.respondLast(FakeTransport::answer(200, "null"));
            QCOMPARE(f.connection.state(), Connection::Connected);
            QVERIFY(!f.connection.isStale());
        }
    }

    void redirectIsNotFollowed()
    {
        Fixture f;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        HttpResponse response = FakeTransport::answer(301, QByteArray());
        response.location = "https://elsewhere.example/";
        f.transport.respondLast(response);
        QCOMPARE(f.connection.state(), Connection::Error);
        QVERIFY(f.connection.errorString().contains(QLatin1String("https://elsewhere.example")));
        QCOMPARE(f.transport.requests.size(), 1);
    }

    void instanceChangeClearsEverything()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        const quint64 generation = f.connection.generation();

        // A request is in flight when the address changes.
        f.connection.fetchCurrentEntry();
        QPointer<FakeReply> pending = f.transport.replies.last();

        f.connection.setInstanceUrl(QStringLiteral("https://other.example.test"));
        // Cleared at once, before any new reply.
        verifyCleared(f.connection);
        QVERIFY(f.connection.generation() > generation);
        QVERIFY(pending && pending->aborted);

        // The old answer arrives late and changes nothing.
        pending->deliver(FakeTransport::answer(200, entryBody(77, 7)));
        verifyCleared(f.connection);
    }

    void accountChangesClearEverything_data()
    {
        QTest::addColumn<QString>("change");
        QTest::newRow("auth mode") << QStringLiteral("mode");
        QTest::newRow("email") << QStringLiteral("email");
        QTest::newRow("secret") << QStringLiteral("secret");
    }

    void accountChangesClearEverything()
    {
        QFETCH(QString, change);
        Fixture f;
        // Password mode, so the email names the account.
        f.store.secrets.insert(passwordKey(QStringLiteral("bea@example.test")), password);
        f.connection.setAuthModeString(QStringLiteral("password"));
        f.connection.setEmail(QStringLiteral("bea@example.test"));
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(populate(f));

        f.connection.fetchProjects();
        QPointer<FakeReply> pending = f.transport.replies.last();
        if (change == QLatin1String("mode")) {
            f.connection.setAuthModeString(QStringLiteral("token"));
        } else if (change == QLatin1String("email")) {
            f.connection.setEmail(QStringLiteral("cai@example.test"));
        } else {
            // The Configure dialog saved a new password for this account.
            f.store.write(passwordKey(QStringLiteral("bea@example.test")), QStringLiteral("new-pw"), &f.store, [](const CredentialResult &) {});
        }
        verifyCleared(f.connection);
        QVERIFY(pending && pending->aborted);
        pending->deliver(FakeTransport::answer(200, projectsBody(7)));
        verifyCleared(f.connection);

        if (change == QLatin1String("secret")) {
            // /me, projects, current entry, the aborted projects request, then /me again.
            QTRY_COMPARE(f.transport.requests.size(), 5);
            QCOMPARE(f.transport.requests.last().authorization, QByteArray("Basic ") + QByteArray("bea@example.test:new-pw").toBase64());
        }
    }

    void staleMeCannotBindTheOldAccount()
    {
        Fixture f;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        QPointer<FakeReply> oldMe = f.transport.replies.last();

        f.store.secrets.insert(tokenKey(QStringLiteral("https://other.example.test")), QStringLiteral("other-token"));
        f.connection.setInstanceUrl(QStringLiteral("https://other.example.test"));
        QTRY_COMPARE(f.transport.requests.size(), 2);

        // The first instance answers after the switch: ignored.
        oldMe->deliver(FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(!f.connection.isConnected());
        QCOMPARE(f.connection.state(), Connection::Connecting);

        f.transport.respondLast(FakeTransport::answer(200, meBody(8, 12)));
        QCOMPARE(f.connection.workspaceId(), 12);
        QCOMPARE(f.connection.account()->id, 8);
    }

    void staleCallbacksDoNotRun()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        bool called = false;
        f.connection.fetchCurrentEntry([&](const auto &) {
            called = true;
        });
        QPointer<FakeReply> pending = f.transport.replies.last();
        f.connection.setEmail(QStringLiteral("ignored-in-token-mode@example.test"));
        f.connection.setAuthModeString(QStringLiteral("password"));
        pending->deliver(FakeTransport::answer(200, entryBody(5, 7)));
        QTest::qWait(10);
        QVERIFY(!called);
        QVERIFY(!f.connection.currentEntry().has_value());
    }

    void identityChangeOnRevalidation()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 7));
        QVERIFY(populate(f));
        const quint64 generation = f.connection.generation();
        f.connection.refreshAccount();
        // Same credentials, another account and workspace: nothing carries over.
        f.transport.respondLast(FakeTransport::answer(200, meBody(4, 8)));
        QVERIFY(f.connection.generation() > generation);
        QCOMPARE(f.connection.workspaceId(), 8);
        QVERIFY(f.connection.projects().isEmpty());
        QVERIFY(!f.connection.currentEntry().has_value());
        QVERIFY(!f.connection.nextProjectId().has_value());
    }

    void nonTokklAnswer()
    {
        Fixture f;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, "<html><body>Welcome</body></html>"));
        QCOMPARE(f.connection.state(), Connection::Error);
        QVERIFY(!f.connection.isConnected());
    }

    // ----- Configure page helper ---------------------------------------------

    void setupSavesAndLoadsSecrets()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        ConnectionSetup setup(&transport, &store);
        QSignalSpy saved(&setup, &ConnectionSetup::secretSaved);
        QSignalSpy loaded(&setup, &ConnectionSetup::secretLoaded);

        setup.saveSecret(instance + QLatin1Char('/'), QStringLiteral("token"), QString(), QStringLiteral("  ") + token + QStringLiteral("\n"));
        QTRY_COMPARE(saved.count(), 1);
        // Same key as the connection uses, and pasted whitespace dropped.
        QCOMPARE(store.secrets.value(tokenKey()), token);

        setup.saveSecret(instance, QStringLiteral("password"), QStringLiteral("Bea@example.test"), QStringLiteral(" pw "));
        QTRY_COMPARE(saved.count(), 2);
        QCOMPARE(store.secrets.value(passwordKey(QStringLiteral("bea@example.test"))), QStringLiteral(" pw "));

        setup.loadSecret(instance, QStringLiteral("token"), QString());
        QTRY_COMPARE(loaded.count(), 1);
        QCOMPARE(loaded.last().first().toString(), token);

        setup.loadSecret(QStringLiteral("https://unknown.example.test"), QStringLiteral("token"), QString());
        QTRY_COMPARE(loaded.count(), 2);
        QCOMPARE(loaded.last().first().toString(), QString());
    }

    void setupReportsWalletDenial()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        store.failure = CredentialResult::Status::Unavailable;
        ConnectionSetup setup(&transport, &store);
        QSignalSpy failed(&setup, &ConnectionSetup::walletFailed);
        QSignalSpy saved(&setup, &ConnectionSetup::secretSaved);

        setup.saveSecret(instance, QStringLiteral("token"), QString(), token);
        QTRY_COMPARE(failed.count(), 1);
        const QString message = failed.last().first().toString();
        QVERIFY(message.contains(QLatin1String("locked or denied")));
        QVERIFY(!message.contains(token));
        QCOMPARE(saved.count(), 0);
        QVERIFY(store.secrets.isEmpty());

        setup.loadSecret(instance, QStringLiteral("token"), QString());
        QTRY_COMPARE(failed.count(), 2);
    }

    void setupTestsUnsavedSettings()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        ConnectionSetup setup(&transport, &store);
        QSignalSpy finished(&setup, &ConnectionSetup::testFinished);

        setup.testConnection(QStringLiteral("https://example.test/sub/path/"), QStringLiteral("token"), QString(), token);
        QCOMPARE(setup.testResult(), ConnectionSetup::Testing);
        QVERIFY(setup.isBusy());
        QCOMPARE(transport.requests.last().url.toString(), QStringLiteral("https://example.test/sub/path/api/v9/me"));
        QCOMPARE(transport.requests.last().authorization, QByteArray("Basic ") + (token + QStringLiteral(":api_token")).toUtf8().toBase64());
        transport.respondLast(FakeTransport::answer(200, meBody(3, 42)));
        QCOMPARE(setup.testResult(), ConnectionSetup::Succeeded);
        QVERIFY(setup.testMessage().contains(QLatin1String("42")));
        QVERIFY(!setup.isBusy());
        // Testing never touches the wallet.
        QCOMPARE(store.reads + store.writes, 0);

        setup.testConnection(instance, QStringLiteral("password"), QStringLiteral("bea@example.test"), password);
        QCOMPARE(transport.requests.last().authorization, QByteArray("Basic ") + QByteArray("bea@example.test:hunter2-pw").toBase64());
        transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);
        QVERIFY(setup.testMessage().contains(QLatin1String("Incorrect username and/or password")));
        QVERIFY(!setup.testMessage().contains(password));

        // A newer test wins over a slower older one.
        setup.testConnection(instance, QStringLiteral("token"), QString(), token);
        QPointer<FakeReply> older = transport.replies.last();
        setup.testConnection(instance, QStringLiteral("token"), QString(), QStringLiteral("second"));
        QVERIFY(older->aborted);
        older->deliver(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(setup.testResult(), ConnectionSetup::Testing);
        transport.respondLast(FakeTransport::answer(429, "\"Too many failed login attempts, try again later\""));
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);

        const qsizetype sent = transport.requests.size();
        setup.testConnection(QStringLiteral("example.test"), QStringLiteral("token"), QString(), token);
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);
        setup.testConnection(instance, QStringLiteral("token"), QString(), QStringLiteral("   "));
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);
        QCOMPARE(transport.requests.size(), sent);
        QVERIFY(finished.count() > 0);
    }

    void setupFlagsPlainHttp()
    {
        ConnectionSetup setup(nullptr, nullptr);
        QVERIFY(setup.isInsecure(QStringLiteral("http://tokkl.example.test")));
        QVERIFY(!setup.isInsecure(QStringLiteral("https://tokkl.example.test")));
        QVERIFY(!setup.isInsecure(QStringLiteral("http://localhost:8080")));
        QVERIFY(!setup.isInsecure(QStringLiteral("http://127.0.0.1:8080")));
        QVERIFY(setup.urlError(QStringLiteral("https://u:p@example.test")).contains(QLatin1String("user name")));
        QCOMPARE(setup.urlError(instance), QString());
    }
};

QTEST_GUILESS_MAIN(ConnectionTest)

#include "connectiontest.moc"
