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
        Connection connection{&transport, &store, testClientName()};
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

    // A page of distinct projects: ids first .. first + count - 1.
    static QByteArray projectPage(int first, int count, qint64 workspace)
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

    void projectsAreIncompleteAtThePageLimit()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 42));
        std::optional<ApiResult<QList<Project>>> received;
        f.connection.fetchProjects([&received](const ApiResult<QList<Project>> &result) {
            received = result;
        });
        const qsizetype before = f.transport.requests.size();
        // Every page up to the limit is full and new.
        for (int page = 1; page <= Connection::maxProjectPages; ++page) {
            QVERIFY(!received);
            f.transport.respondLast(FakeTransport::answer(200, projectPage((page - 1) * Connection::projectPageSize + 1, Connection::projectPageSize, 42)));
        }
        // Reading stopped at the limit instead of asking for page 101: the
        // first page's request already exists, one more per later page.
        QCOMPARE(f.transport.requests.size(), before + Connection::maxProjectPages - 1);
        QVERIFY(received);
        QVERIFY(received->ok());
        QCOMPARE(received->value->size(), Connection::maxProjectPages * Connection::projectPageSize);
        // The truncated list is reported, not passed off as the whole list.
        QVERIFY(f.connection.projectsIncomplete());
        QCOMPARE(f.connection.projectList().size(), Connection::maxProjectPages * Connection::projectPageSize);

        // A short last page ends the reading as complete, and clears the flag.
        received.reset();
        f.connection.fetchProjects([&received](const ApiResult<QList<Project>> &result) {
            received = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1000, 3, 42)));
        QVERIFY(received && received->ok());
        QVERIFY(!f.connection.projectsIncomplete());
        QCOMPARE(received->value->size(), Connection::projectPageSize + 3);

        // A full page of nothing new is a server ignoring the paging, and
        // also ends the reading as before.
        received.reset();
        f.connection.fetchProjects([&received](const ApiResult<QList<Project>> &result) {
            received = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        QVERIFY(received && received->ok());
        QVERIFY(!f.connection.projectsIncomplete());
    }

    void projectsFollowEveryPage()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 42));
        auto page = [](int first, int count, qint64 workspace) {
            QJsonArray projects;
            for (int id = first; id < first + count; ++id) {
                projects.append(QJsonObject{{QStringLiteral("id"), id},
                                            {QStringLiteral("workspace_id"), workspace},
                                            {QStringLiteral("name"), QStringLiteral("P%1").arg(id)},
                                            {QStringLiteral("active"), true}});
            }
            return QJsonDocument(projects).toJson(QJsonDocument::Compact);
        };

        QList<Project> received;
        f.connection.fetchProjects([&received](const ApiResult<QList<Project>> &result) {
            QVERIFY(result.ok());
            received = *result.value;
        });
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects?active=true&page=2&per_page=200"));
        QVERIFY(received.isEmpty());
        // Another workspace's project is never offered.
        f.transport.respondLast(FakeTransport::answer(200, page(1000, 1, 42).chopped(1) + ',' + page(1001, 1, 9).sliced(1)));
        QCOMPARE(received.size(), Connection::projectPageSize + 1);
        QCOMPARE(f.connection.projectList().size(), Connection::projectPageSize + 1);
        QCOMPARE(received.last().id, 1000);

        // A server that ignores the paging parameters sends the same full
        // page again; reading stops there.
        const qsizetype before = f.transport.requests.size();
        f.connection.fetchProjects();
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        QCOMPARE(f.transport.requests.size(), before + 2);
        QCOMPARE(f.connection.projectList().size(), Connection::projectPageSize);

        // One project, archived or not, of the bound workspace only.
        std::optional<Project> archived;
        f.connection.fetchProject(33, [&archived](const ApiResult<Project> &result) {
            archived = result.value;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects/33"));
        f.transport.respondLast(FakeTransport::answer(200, R"({"id":33,"workspace_id":42,"name":"Old","active":false})"));
        QVERIFY(archived);
        QVERIFY(!archived->active);
    }

    void webUrlCarriesNoCredentials()
    {
        Fixture f;
        QCOMPARE(f.connection.webUrl(), QUrl());
        f.connection.setInstanceUrl(QStringLiteral(" HTTPS://Example.test:443/tokkl/ "));
        QCOMPARE(f.connection.webUrl(), QUrl(QStringLiteral("https://example.test/tokkl/")));
        f.connection.setInstanceUrl(QStringLiteral("https://example.test"));
        QCOMPARE(f.connection.webUrl(), QUrl(QStringLiteral("https://example.test/")));
        f.connection.setInstanceUrl(QStringLiteral("https://user:secret@example.test"));
        QCOMPARE(f.connection.webUrl(), QUrl());
        f.connection.setInstanceUrl(QStringLiteral("https://example.test/?token=secret"));
        QCOMPARE(f.connection.webUrl(), QUrl());
    }

    void discoveredWorkspaceScopesEveryOperation()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 42));
        QCOMPARE(f.connection.workspaceId(), 42);
        QCOMPARE(f.connection.accountMap().value(QStringLiteral("defaultWorkspaceId")).toLongLong(), 42);

        f.connection.fetchProjects();
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects?active=true&page=1&per_page=200"));
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

    // The store reports every write: secretChanged when it kept the secret,
    // secretWriteFailed with the status and no secret when it did not.
    void storeReportsWritesWithoutTheSecret()
    {
        class ReportingStore : public FakeCredentialStore
        {
        public:
            // A failed result that still carries a secret must not pass it on.
            void reportLeaky(const QString &key)
            {
                reportWrite(key, CredentialResult{CredentialResult::Status::Failed, QStringLiteral("leaked-secret")});
            }
        };
        ReportingStore store;
        QStringList changed;
        QList<std::pair<QString, CredentialResult>> failed;
        connect(&store, &CredentialStore::secretChanged, this, [&changed](const QString &key) {
            changed.append(key);
        });
        connect(&store, &CredentialStore::secretWriteFailed, this, [&failed](const QString &key, const CredentialResult &result) {
            failed.append({key, result});
        });

        store.write(tokenKey(), token, this, [](const CredentialResult &) { });
        QCOMPARE(changed, QStringList{tokenKey()});
        QVERIFY(failed.isEmpty());

        store.failure = CredentialResult::Status::Unavailable;
        store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        QCOMPARE(changed.size(), 1);
        QCOMPARE(failed.size(), 1);
        QCOMPARE(failed.first().first, tokenKey());
        QCOMPARE(failed.first().second.status, CredentialResult::Status::Unavailable);
        QVERIFY(failed.first().second.secret.isEmpty());

        store.reportLeaky(tokenKey());
        QCOMPARE(failed.size(), 2);
        QCOMPARE(failed.last().second.status, CredentialResult::Status::Failed);
        QVERIFY(failed.last().second.secret.isEmpty());
    }

    // A settings page saves a secret for the connection's own account and the
    // store refuses: the connection drops the account and says the new
    // credentials were not saved, even when the page is already gone.
    void refusedWriteForTheOwnKeyShowsWalletError()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        const qsizetype requests = f.transport.requests.size();

        f.store.failure = CredentialResult::Status::Unavailable;
        {
            ConnectionSetup setup(&f.transport, &f.store);
            setup.setAccount(instance, QStringLiteral("token"), QString());
            setup.editSecret(QStringLiteral("refused-secret"));
            setup.saveSecret();
        }
        QTRY_COMPARE(f.connection.state(), Connection::WalletError);
        QVERIFY2(f.connection.errorString().startsWith(QLatin1String("The new credentials were not saved.")), qPrintable(f.connection.errorString()));
        QVERIFY(f.connection.errorString().contains(QLatin1String("locked or denied")));
        QVERIFY(!f.connection.errorString().contains(QLatin1String("refused-secret")));
        verifyCleared(f.connection);

        // The old secret is still in the store, but nothing is validated or
        // sent with it until the user reconnects.
        QTest::qWait(20);
        QCOMPARE(f.connection.state(), Connection::WalletError);
        QCOMPARE(f.transport.requests.size(), requests);
    }

    // A wallet read that started before the refused write answers after it,
    // with the old secret. It belongs to an older generation and cannot
    // replace the error.
    void refusedWriteOutranksAnEarlierRead()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const int reads = f.store.reads;
        const qsizetype requests = f.transport.requests.size();

        f.connection.reconnect();
        QCOMPARE(f.store.reads, reads + 1);
        f.store.failure = CredentialResult::Status::Failed;
        f.store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        QCOMPARE(f.connection.state(), Connection::WalletError);

        QTest::qWait(20);
        QCOMPARE(f.connection.state(), Connection::WalletError);
        QVERIFY(f.connection.errorString().startsWith(QLatin1String("The new credentials were not saved.")));
        QCOMPARE(f.transport.requests.size(), requests);
    }

    // A refused write for another account leaves this one connected.
    void refusedWriteForAnotherKeyIsIgnored()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.store.failure = CredentialResult::Status::Unavailable;
        f.store.write(tokenKey(QStringLiteral("https://other.example.test")), QStringLiteral("other"), this, [](const CredentialResult &) { });
        QTest::qWait(20);
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.isConnected());
    }

    // A settings page may save the secret before Plasma hands the matching
    // settings to the connection. The refusal is kept and shown on the
    // reload those settings start, without reading the store.
    void refusedWriteBeforeTheSettingsShowsOnReload()
    {
        Fixture f;
        f.store.secrets.insert(tokenKey(), token);
        f.store.failure = CredentialResult::Status::Unavailable;
        f.store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        QCOMPARE(f.connection.state(), Connection::Unconfigured);

        f.store.failure = CredentialResult::Status::Ok;
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.connection.state(), Connection::WalletError);
        QVERIFY(f.connection.errorString().startsWith(QLatin1String("The new credentials were not saved.")));
        QVERIFY(f.connection.errorString().contains(QLatin1String("locked or denied")));
        QCOMPARE(f.store.reads, 0);
        QVERIFY(f.transport.requests.isEmpty());

        // Reconnect clears it and uses what the store holds.
        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.last().authorization, basicAuthorization(AuthMode::Token, QString(), token));
    }

    // The kept refusal lasts until the next reload only, and it is shown
    // only when that reload is for its key.
    void refusedWriteBeforeOtherSettingsIsDropped()
    {
        Fixture f;
        const QString other = QStringLiteral("https://other.example.test");
        f.store.failure = CredentialResult::Status::Unavailable;
        f.store.write(tokenKey(other), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        f.store.failure = CredentialResult::Status::Ok;

        QVERIFY(connectAccount(f));
        f.connection.setInstanceUrl(other);
        QTRY_COMPARE(f.connection.state(), Connection::CredentialsMissing);
        QVERIFY(!f.connection.errorString().contains(QLatin1String("not saved")));
    }

    // A later successful write of the same key replaces the refusal: before
    // the settings arrive, and while the connection shows it.
    void successfulWriteClearsARefusal()
    {
        Fixture f;
        f.store.failure = CredentialResult::Status::Unavailable;
        f.store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        f.store.failure = CredentialResult::Status::Ok;
        f.store.write(tokenKey(), token, this, [](const CredentialResult &) { });

        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);

        f.store.failure = CredentialResult::Status::Disabled;
        f.store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        QCOMPARE(f.connection.state(), Connection::WalletError);
        QVERIFY(f.connection.errorString().startsWith(QLatin1String("The new credentials were not saved.")));
        QVERIFY(f.connection.errorString().contains(QLatin1String("disabled")));

        const QString fresh = QStringLiteral("tok-fresh");
        f.store.failure = CredentialResult::Status::Ok;
        f.store.write(tokenKey(), fresh, this, [](const CredentialResult &) { });
        QTRY_COMPARE(f.transport.requests.size(), 2);
        QCOMPARE(f.transport.requests.last().authorization, basicAuthorization(AuthMode::Token, QString(), fresh));
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
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

    // fetchMe() validates the account like refreshAccount(); a workspace
    // operation leaves a 403 to its caller.
    void fetchMeForbiddenPausesAuthentication()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));

        std::optional<ApiResult<QList<Project>>> projects;
        f.connection.fetchProjects([&](const auto &r) {
            projects = r;
        });
        f.transport.respondLast(FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(projects && projects->error.kind == ApiError::Kind::Forbidden);
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.canWrite());
        QVERIFY(f.connection.account().has_value());

        QSignalSpy accountChanged(&f.connection, &Connection::accountChanged);
        bool answered = false;
        f.connection.fetchMe([&](const auto &) {
            answered = true;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QLatin1String("Incorrect username and/or password")));
        verifyCleared(f.connection);
        QVERIFY(accountChanged.count() >= 1);
        // As for a 401: the request belonged to the account that is gone.
        QVERIFY(!answered);

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

        // A 401 from fetchMe() is handled the same way.
        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        f.connection.fetchMe();
        f.transport.respondLast(FakeTransport::answer(401, "\"Invalid credentials\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QLatin1String("Invalid credentials")));
        verifyCleared(f.connection);
    }

    // The current entry request validates the account like /me: the
    // middleware answers 403 or 401 there for refused credentials.
    void currentEntryRefusedPausesAuthentication_data()
    {
        QTest::addColumn<int>("status");
        QTest::addColumn<QByteArray>("body");
        QTest::newRow("403") << 403 << QByteArray("\"Incorrect username and/or password\"");
        QTest::newRow("401") << 401 << QByteArray("\"Invalid credentials\"");
    }

    void currentEntryRefusedPausesAuthentication()
    {
        QFETCH(int, status);
        QFETCH(QByteArray, body);
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(populate(f));
        QSignalSpy accountChanged(&f.connection, &Connection::accountChanged);

        bool answered = false;
        f.connection.fetchCurrentEntry([&](const auto &) {
            answered = true;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me/time_entries/current"));
        f.transport.respondLast(FakeTransport::answer(status, body));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QString::fromUtf8(body).remove(QLatin1Char('"'))));
        verifyCleared(f.connection);
        QVERIFY(accountChanged.count() >= 1);
        // The request belonged to the account that is gone.
        QVERIFY(!answered);

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

        // An explicit reconnect validates again.
        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
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

        setup.setAccount(instance + QLatin1Char('/'), QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("  ") + token + QStringLiteral("\n"));
        setup.saveSecret();
        // Same key as the connection uses, and pasted whitespace dropped.
        QTRY_COMPARE(store.secrets.value(tokenKey()), token);
        QTRY_VERIFY(!setup.isBusy());

        setup.setAccount(instance, QStringLiteral("password"), QStringLiteral("Bea@example.test"));
        setup.editSecret(QStringLiteral(" pw "));
        setup.saveSecret();
        QTRY_COMPARE(store.secrets.value(passwordKey(QStringLiteral("bea@example.test"))), QStringLiteral(" pw "));
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(store.writes, 2);

        ConnectionSetup reopened(&transport, &store);
        reopened.setAccount(instance, QStringLiteral("token"), QString());
        reopened.loadSecret();
        QTRY_COMPARE(reopened.secret(), token);
        QTRY_VERIFY(!reopened.isBusy());
        // Apply with the stored secret unchanged writes nothing.
        reopened.saveSecret();
        QCOMPARE(store.writes, 2);

        reopened.setAccount(QStringLiteral("https://unknown.example.test"), QStringLiteral("token"), QString());
        reopened.loadSecret();
        QTRY_VERIFY(!reopened.isBusy());
        QCOMPARE(reopened.secret(), QString());
        QCOMPARE(reopened.walletError(), QString());
    }

    void setupReportsWalletDenial()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        store.failure = CredentialResult::Status::Unavailable;
        ConnectionSetup setup(&transport, &store);

        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.editSecret(token);
        setup.saveSecret();
        QTRY_VERIFY(!setup.walletError().isEmpty());
        const QString message = setup.walletError();
        QVERIFY(message.contains(QLatin1String("locked or denied")));
        QVERIFY(!message.contains(token));
        QVERIFY(store.secrets.isEmpty());

        ConnectionSetup reading(&transport, &store);
        reading.setAccount(instance, QStringLiteral("token"), QString());
        reading.loadSecret();
        QTRY_COMPARE(reading.walletError(), message);
    }

    // The callback form of saveSecret tells the caller when the store has
    // kept the secret, so a settings window can wait for it before closing.
    void setupReportsWhenTheSecretIsSaved()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        ConnectionSetup setup(&transport, &store);
        QList<bool> results;
        const auto record = [&results](bool saved) {
            results.append(saved);
        };

        // Nothing to write: done runs at once, with true.
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.saveSecret(this, record);
        QCOMPARE(results, QList<bool>{true});
        QCOMPARE(store.writes, 0);

        // A write: done waits for the store's answer.
        results.clear();
        setup.editSecret(token);
        setup.saveSecret(this, record);
        QVERIFY(results.isEmpty());
        QTRY_COMPARE(results, QList<bool>{true});
        QCOMPARE(store.secrets.value(tokenKey()), token);
        QCOMPARE(setup.walletError(), QString());
        QVERIFY(!setup.isBusy());

        // The stored secret again: nothing to write, true at once.
        results.clear();
        setup.saveSecret(this, record);
        QCOMPARE(results, QList<bool>{true});
        QCOMPARE(store.writes, 1);

        // A refused write: false, and walletError says why without the secret.
        results.clear();
        store.failure = CredentialResult::Status::Unavailable;
        setup.editSecret(QStringLiteral("refused-secret"));
        setup.saveSecret(this, record);
        QVERIFY(results.isEmpty());
        QTRY_COMPARE(results, QList<bool>{false});
        QVERIFY(!setup.walletError().isEmpty());
        QVERIFY(!setup.walletError().contains(QLatin1String("refused-secret")));
        QCOMPARE(store.secrets.value(tokenKey()), token);
        QVERIFY(!setup.isBusy());

        // A context gone before the answer: the write still lands, done never runs.
        results.clear();
        store.failure = CredentialResult::Status::Ok;
        setup.editSecret(QStringLiteral("late-secret"));
        auto *context = new QObject;
        setup.saveSecret(context, record);
        delete context;
        QTRY_COMPARE(store.secrets.value(tokenKey()), QStringLiteral("late-secret"));
        QTRY_VERIFY(!setup.isBusy());
        QCoreApplication::processEvents();
        QVERIFY(results.isEmpty());
        QCOMPARE(setup.walletError(), QString());

        // No credential store: false at once.
        ConnectionSetup storeless(&transport, nullptr);
        storeless.setAccount(instance, QStringLiteral("token"), QString());
        storeless.editSecret(token);
        storeless.saveSecret(this, record);
        QCOMPARE(results, QList<bool>{false});
        QVERIFY(!storeless.walletError().isEmpty());
    }

    // A secret read from the wallet for one account is never tested against
    // or saved under another one.
    void setupClearsASecretOnAccountChange()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        store.secrets.insert(tokenKey(), token);
        store.secrets.insert(passwordKey(QStringLiteral("bea@example.test")), password);
        ConnectionSetup setup(&transport, &store);
        const QString other = QStringLiteral("https://other.example.test");

        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_COMPARE(setup.secret(), token);

        // Another address with nothing stored.
        setup.setAccount(other, QStringLiteral("token"), QString());
        QCOMPARE(setup.secret(), QString());
        setup.testAccount();
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);
        setup.saveSecret();
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.secret(), QString());
        QVERIFY(transport.requests.isEmpty());
        QCOMPARE(store.writes, 0);
        QVERIFY(!store.secrets.contains(tokenKey(other)));

        // The same address with another sign-in method or email.
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_COMPARE(setup.secret(), token);
        setup.setAccount(instance, QStringLiteral("password"), QStringLiteral("bea@example.test"));
        QCOMPARE(setup.secret(), QString());
        setup.loadSecret();
        QTRY_COMPARE(setup.secret(), password);
        setup.setAccount(instance, QStringLiteral("password"), QStringLiteral("cy@example.test"));
        QCOMPARE(setup.secret(), QString());
        setup.testAccount();
        setup.saveSecret();
        QTRY_VERIFY(!setup.isBusy());
        QVERIFY(transport.requests.isEmpty());
        QCOMPARE(store.writes, 0);

        // Only the account matters: the same address written differently, or
        // an email typed during token sign-in, keeps the secret.
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_COMPARE(setup.secret(), token);
        setup.setAccount(instance + QLatin1Char('/'), QStringLiteral("token"), QStringLiteral("cy@example.test"));
        QCOMPARE(setup.secret(), token);
    }

    void setupDropsStaleWalletResults()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        store.secrets.insert(tokenKey(), token);
        ConnectionSetup setup(&transport, &store);

        // The read for the first address finishes after the page moved on.
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        setup.setAccount(QStringLiteral("https://other.example.test"), QStringLiteral("token"), QString());
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(store.reads, 1);
        QCOMPARE(setup.secret(), QString());
        setup.saveSecret();
        QCOMPARE(store.writes, 0);

        // Also while the address is incomplete.
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        setup.setAccount(QStringLiteral("https://"), QStringLiteral("token"), QString());
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.secret(), QString());
    }

    void setupKeepsATypedSecret()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        store.secrets.insert(tokenKey(), token);
        ConnectionSetup setup(&transport, &store);
        const QString other = QStringLiteral("https://other.example.test");
        const QString typed = QStringLiteral("typed-for-other");

        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_COMPARE(setup.secret(), token);
        setup.setAccount(other, QStringLiteral("token"), QString());
        setup.editSecret(typed);
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.secret(), typed);

        setup.testAccount();
        QCOMPARE(transport.requests.size(), 1);
        QCOMPARE(transport.requests.last().url.host(), QStringLiteral("other.example.test"));
        QCOMPARE(transport.requests.last().authorization, basicAuthorization(AuthMode::Token, QString(), typed));
        transport.respondLast(FakeTransport::answer(200, meBody(4, 9)));

        setup.saveSecret();
        QTRY_COMPARE(store.secrets.value(tokenKey(other)), typed);
        QCOMPARE(store.secrets.value(tokenKey()), token);

        // Once saved, the secret belongs to that account like a loaded one,
        // even before the write finishes.
        setup.editSecret(QStringLiteral("replacement"));
        setup.saveSecret();
        setup.setAccount(instance, QStringLiteral("token"), QString());
        QCOMPARE(setup.secret(), QString());
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(store.secrets.value(tokenKey(other)), QStringLiteral("replacement"));
        QCOMPARE(store.secrets.value(tokenKey()), token);

        // A typed secret wins over a stored one that arrives later.
        setup.setAccount(other, QStringLiteral("token"), QString());
        setup.editSecret(typed);
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.secret(), typed);
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

    void setupPersistsOnlyAValidatedUrl()
    {
        ConnectionSetup setup(nullptr, nullptr);
        QCOMPARE(setup.persistedUrl(QStringLiteral(" HTTPS://Example.test:443/tokkl/ ")), instance);
        QCOMPARE(setup.persistedUrl(QStringLiteral("http://127.0.0.1:8080/")), QStringLiteral("http://127.0.0.1:8080"));
        QCOMPARE(setup.persistedUrl(instance), instance);
        // Normalizing twice changes nothing, so the field and the setting agree.
        const QString once = setup.persistedUrl(QStringLiteral("https://example.test/a%20b/"));
        QCOMPARE(setup.persistedUrl(once), once);

        for (const QString &rejected : {QStringLiteral("https://user:password@example.test"),
                                        QStringLiteral("https://user@example.test/tokkl"),
                                        QStringLiteral("https://example.test/tokkl?token=x"),
                                        QStringLiteral("https://example.test/tokkl#x"),
                                        QStringLiteral("example.test"),
                                        QStringLiteral("ftp://example.test"),
                                        QString()}) {
            QVERIFY2(setup.persistedUrl(rejected).isEmpty(), qPrintable(rejected));
        }
    }
};

QTEST_GUILESS_MAIN(ConnectionTest)

#include "connectiontest.moc"
