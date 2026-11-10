#include "connection.h"
#include "connectionsettings.h"
#include "connectionsetup.h"
#include "cooldown.h"
#include "fakes.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QSettings>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://example.test/tokkl");
const QString token = QStringLiteral("tok-7f3a9c");
const QString password = QStringLiteral("hunter2-pw");

// Carries the API token so the log check covers it.
QByteArray meWithToken(qint64 id, qint64 workspace)
{
    QJsonObject me = QJsonDocument::fromJson(meBody(id, workspace)).object();
    me.insert(QStringLiteral("api_token"), token);
    return json(me);
}

QByteArray stateBody(qint64 revision = 1)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("revision"), revision},
                             {QStringLiteral("server_time"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
                             {QStringLiteral("running_entry"), QJsonValue::Null},
                             {QStringLiteral("pause"), QJsonValue::Null},
                             {QStringLiteral("pomodoro"), QJsonValue::Null},
                             {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
                         })
        .toJson(QJsonDocument::Compact);
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

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        Connection connection{&transport, &store, clock, testClientName()};
    };

    static QString tokenKey(const QString &url = instance)
    {
        return credentialKey(parseInstanceUrl(url), AuthMode::Token, QString());
    }

    static QString passwordKey(const QString &email, const QString &url = instance)
    {
        return credentialKey(parseInstanceUrl(url), AuthMode::Password, email);
    }

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
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(userId, workspace)));
        return f.connection.state() == Connection::Connected;
    }

    static void verifyCleared(const Connection &connection)
    {
        QVERIFY(!connection.isConnected());
        QVERIFY(!connection.canWrite());
        QVERIFY(!connection.account().has_value());
        QCOMPARE(connection.workspaceId(), 0);
        QVERIFY(connection.accountMap().isEmpty());
    }

private Q_SLOTS:
    void initTestCase()
    {
        previousHandler = qInstallMessageHandler(captureLog);
    }

    void cleanupTestCase()
    {
        qInstallMessageHandler(previousHandler);
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
        QCOMPARE(f.store.reads, 1);
        QCOMPARE(f.transport.requests.first().authorization, QByteArray("Basic ") + QByteArray("Bea@example.test:hunter2-pw").toBase64());
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.connection.account()->email, QStringLiteral("bea@example.test"));
    }

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
        std::optional<ApiResult<ProjectList>> received;
        f.connection.fetchProjects([&received](const ApiResult<ProjectList> &result) {
            received = result;
        });
        const qsizetype before = f.transport.requests.size();
        for (int page = 1; page <= Connection::maxProjectPages; ++page) {
            QVERIFY(!received);
            f.transport.respondLast(FakeTransport::answer(200, projectPage((page - 1) * Connection::projectPageSize + 1, Connection::projectPageSize, 42)));
        }
        // Reading stopped at the limit instead of asking for page 101: the
        // first page's request already exists, one more per later page.
        QCOMPARE(f.transport.requests.size(), before + Connection::maxProjectPages - 1);
        QVERIFY(received);
        QVERIFY(received->ok());
        QCOMPARE(received->value->projects.size(), Connection::maxProjectPages * Connection::projectPageSize);
        QVERIFY(received->value->incomplete);

        received.reset();
        f.connection.fetchProjects([&received](const ApiResult<ProjectList> &result) {
            received = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1000, 3, 42)));
        QVERIFY(received && received->ok());
        QVERIFY(!received->value->incomplete);
        QCOMPARE(received->value->projects.size(), Connection::projectPageSize + 3);

        // A full page of nothing new is a server ignoring the paging, and
        // also ends the reading as before.
        received.reset();
        f.connection.fetchProjects([&received](const ApiResult<ProjectList> &result) {
            received = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, projectPage(1, Connection::projectPageSize, 42)));
        QVERIFY(received && received->ok());
        QVERIFY(!received->value->incomplete);
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
        f.connection.fetchProjects([&received](const ApiResult<ProjectList> &result) {
            QVERIFY(result.ok());
            received = result.value->projects;
        });
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects?active=true&page=2&per_page=200"));
        QVERIFY(received.isEmpty());
        f.transport.respondLast(FakeTransport::answer(200, page(1000, 1, 42).chopped(1) + ',' + page(1001, 1, 9).sliced(1)));
        QCOMPARE(received.size(), Connection::projectPageSize + 1);
        QCOMPARE(received.last().id, 1000);

        // A server that ignores the paging parameters sends the same full
        // page again; reading stops there.
        const qsizetype before = f.transport.requests.size();
        f.connection.fetchProjects([&received](const ApiResult<ProjectList> &result) {
            received = result.value->projects;
        });
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        f.transport.respondLast(FakeTransport::answer(200, page(1, Connection::projectPageSize, 42)));
        QCOMPARE(f.transport.requests.size(), before + 2);
        QCOMPARE(received.size(), Connection::projectPageSize);

        std::optional<Project> archived;
        f.connection.fetchProject(33, [&archived](const ApiResult<Project> &result) {
            archived = result.value;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects/33"));
        f.transport.respondLast(FakeTransport::answer(200, R"({"id":33,"workspace_id":42,"name":"Old","active":false})"));
        QVERIFY(archived);
        QVERIFY(!archived->active);
    }

    void catalogRevisionOfTheWorkspace()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 42));
        f.transport.holdCatalog = true;
        std::optional<ApiResult<qint64>> received;
        f.connection.fetchCatalogRevision([&received](const ApiResult<qint64> &result) {
            received = result;
        });
        QCOMPARE(f.transport.catalogRequests.size(), 1);
        QCOMPARE(f.transport.catalogRequests.last().url.path(), QStringLiteral("/tokkl/api/app/workspaces/42/catalog"));
        f.transport.respondCatalog(0, FakeTransport::catalogAt(17));
        QVERIFY(received && received->ok());
        QCOMPARE(*received->value, 17);

        received.reset();
        f.connection.fetchCatalogRevision([&received](const ApiResult<qint64> &result) {
            received = result;
        });
        f.transport.respondCatalog(1, FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(received && !received->ok());
        QCOMPARE(received->error.kind, ApiError::Kind::Forbidden);
    }

    void settingsRoundTrip()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString file = dir.filePath(QStringLiteral("tokkl.conf"));
        {
            QSettings settings(file, QSettings::IniFormat);
            QCOMPARE(ConnectionSettings::read(settings), ConnectionSettings{});
            QVERIFY((ConnectionSettings{instance, QStringLiteral("password"), QStringLiteral("bea@example.test")}.write(settings)));
        }
        QSettings settings(file, QSettings::IniFormat);
        QCOMPARE(settings.value(QStringLiteral("instanceUrl")).toString(), instance);
        QCOMPARE(settings.value(QStringLiteral("authMode")).toString(), QStringLiteral("password"));
        QCOMPARE(settings.value(QStringLiteral("email")).toString(), QStringLiteral("bea@example.test"));
        const ConnectionSettings read = ConnectionSettings::read(settings);
        QCOMPARE(read.instanceUrl, instance);

        Fixture f;
        read.applyTo(f.connection);
        QCOMPARE(f.connection.instanceUrl(), instance);
        QCOMPARE(f.connection.authMode(), AuthMode::Password);
        QCOMPARE(f.connection.email(), QStringLiteral("bea@example.test"));
    }

    // QSettings keeps the first error it meets, so a write after a failed one
    // must still report its own outcome.
    void settingsWriteAfterAFailedOne()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString file = dir.filePath(QStringLiteral("tokkl.conf"));
        QSettings settings(file, QSettings::IniFormat);
        settings.setValue(QStringLiteral("monochromeIcon"), true);
        QVERIFY(QDir().mkpath(file));
        QVERIFY(!(ConnectionSettings{instance, QStringLiteral("token"), QString()}.write(settings)));
        QVERIFY(!settings.contains(ConnectionSettings::instanceUrlKey));

        QVERIFY(QDir(file).removeRecursively());
        const ConnectionSettings next{instance, QStringLiteral("password"), QStringLiteral("bea@example.test")};
        QVERIFY(next.write(settings));
        QCOMPARE(ConnectionSettings::read(settings), next);
        QFile written(file);
        QVERIFY(written.open(QIODevice::ReadOnly));
        const QByteArray content = written.readAll();
        QVERIFY(content.contains("authMode=password"));
        QVERIFY(content.contains("email=bea@example.test"));
        QVERIFY(content.contains("monochromeIcon=true"));
        QVERIFY((ConnectionSettings{instance, QStringLiteral("token"), QString()}.write(settings)));
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

        std::optional<ApiResult<ProjectList>> projects;
        f.connection.fetchProjects([&projects](const ApiResult<ProjectList> &result) {
            projects = result;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/workspaces/42/projects?active=true&page=1&per_page=200"));
        f.transport.respondLast(FakeTransport::answer(200, projectsBody(42)));
        QVERIFY(projects && projects->ok());
        QCOMPARE(projects->value->projects.size(), 1);

        StartEntry start;
        start.start = QDateTime::currentDateTimeUtc();
        start.projectId = 11;
        f.connection.startTimer(1, start);
        const HttpRequest post = f.transport.requests.last();
        QCOMPARE(post.method, QByteArray("POST"));
        QCOMPARE(path(post), QStringLiteral("/tokkl/api/app/timer/start"));
        QCOMPARE(QJsonDocument::fromJson(post.body).object().value(QLatin1String("workspace_id")).toInteger(), 42);

        PomodoroStart session;
        f.connection.startPomodoro(1, session);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/app/pomodoro"));
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.last().body).object().value(QLatin1String("workspace_id")).toInteger(), 42);

        for (const HttpRequest &request : std::as_const(f.transport.requests)) {
            QVERIFY2(!path(request).contains(QLatin1String("/workspaces/1/")), qPrintable(path(request)));
        }
    }

    void typedResults()
    {
        Fixture f;
        QVERIFY(connectAccount(f));

        std::optional<ApiResult<TimerState>> current;
        f.connection.fetchTimerState([&](const auto &result) {
            current = result;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/app/timer"));
        f.transport.respondLast(FakeTransport::answer(200, stateBody(4)));
        QVERIFY(current && current->ok());
        QCOMPARE(current->value->revision, 4);
        QVERIFY(!current->value->runningEntry);

        std::optional<ApiResult<Me>> me;
        f.connection.fetchMe([&](const auto &result) {
            me = result;
        });
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QVERIFY(me && me->ok());
        QCOMPARE(me->value->defaultWorkspaceId, 7);

        std::optional<ApiResult<Project>> project;
        f.connection.fetchProject(99, [&](const auto &result) {
            project = result;
        });
        f.transport.respondLast(FakeTransport::answer(404, "\"Project not found\""));
        QVERIFY(project && !project->ok());
        QVERIFY(project->error.kind == ApiError::Kind::Client);
        QCOMPARE(project->error.message, QStringLiteral("Project not found"));

        std::optional<ApiResult<ProjectList>> projects;
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
        std::optional<TimerActionResult> result;
        StartEntry start;
        start.start = QDateTime::currentDateTimeUtc();
        f.connection.startTimer(1, start, [&](const TimerActionResult &r) {
            result = r;
        });
        QTRY_VERIFY(result.has_value());
        QVERIFY(result->outcome == TimerActionResult::Outcome::Refused);
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
        f.store.failure = CredentialResult::Status::Unavailable;
        f.connection.reconnect();
        QTRY_COMPARE(f.connection.state(), Connection::WalletError);
        verifyCleared(f.connection);
    }

    void storeReportsWritesWithoutTheSecret()
    {
        class ReportingStore : public FakeCredentialStore
        {
        public:
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

    // The connection drops the account even when the settings page is gone.
    void refusedWriteForTheOwnKeyShowsWalletError()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
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

        QTest::qWait(20);
        QCOMPARE(f.connection.state(), Connection::WalletError);
        QCOMPARE(f.transport.requests.size(), requests);
    }

    // The earlier read belongs to an older generation and cannot replace the error.
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

    // A settings page may save the secret before Plasma hands the connection the
    // matching settings; the reload those settings start shows the refusal.
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

        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.last().authorization, basicAuthorization(AuthMode::Token, QString(), token));
    }

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

    void successfulWriteClearsARefusal()
    {
        Fixture f;
        f.store.failure = CredentialResult::Status::Unavailable;
        f.store.write(tokenKey(), QStringLiteral("refused-secret"), this, [](const CredentialResult &) { });
        f.store.failure = CredentialResult::Status::Ok;
        f.store.write(tokenKey(), token, this, [](const CredentialResult &) { });

        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
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
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
    }

    void meForbiddenPausesAuthentication()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QSignalSpy accountChanged(&f.connection, &Connection::accountChanged);

        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QLatin1String("Incorrect username and/or password")));
        // A generic 403 does not establish that the account is disabled.
        QVERIFY(!f.connection.errorString().contains(QLatin1String("disabled"), Qt::CaseInsensitive));
        verifyCleared(f.connection);
        QVERIFY(accountChanged.count() >= 1);

        const qsizetype sent = f.transport.requests.size();
        std::optional<TimerActionResult> write;
        f.connection.stopTimer(1, [&](const TimerActionResult &r) {
            write = r;
        });
        QTRY_VERIFY(write.has_value());
        QVERIFY(write->outcome == TimerActionResult::Outcome::Refused);
        QVERIFY(write->error.kind == ApiError::Kind::AuthenticationPaused);
        f.connection.refreshAccount();
        QTest::qWait(20);
        QCOMPARE(f.transport.requests.size(), sent);

        QCOMPARE(f.store.secrets.value(tokenKey()), token);
        QCOMPARE(f.store.writes, 0);

        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
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
        std::optional<ApiResult<ProjectList>> result;
        f.connection.fetchProjects([&](const auto &r) {
            result = r;
        });
        f.transport.respondLast(FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(result && result->error.kind == ApiError::Kind::Forbidden);
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.isConnected());
    }

    void fetchMeForbiddenPausesAuthentication()
    {
        Fixture f;
        QVERIFY(connectAccount(f));

        std::optional<ApiResult<ProjectList>> projects;
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
        QVERIFY(!answered);

        const qsizetype sent = f.transport.requests.size();
        std::optional<TimerActionResult> write;
        f.connection.stopTimer(1, [&](const TimerActionResult &r) {
            write = r;
        });
        QTRY_VERIFY(write.has_value());
        QVERIFY(write->outcome == TimerActionResult::Outcome::Refused);
        QVERIFY(write->error.kind == ApiError::Kind::AuthenticationPaused);
        f.connection.refreshAccount();
        QTest::qWait(20);
        QCOMPARE(f.transport.requests.size(), sent);

        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        f.connection.fetchMe();
        f.transport.respondLast(FakeTransport::answer(401, "\"Invalid credentials\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QLatin1String("Invalid credentials")));
        verifyCleared(f.connection);
    }

    // The middleware answers 403 or 401 on the timer state for refused credentials.
    void timerStateRefusedPausesAuthentication_data()
    {
        QTest::addColumn<int>("status");
        QTest::addColumn<QByteArray>("body");
        QTest::newRow("403") << 403 << QByteArray("\"Incorrect username and/or password\"");
        QTest::newRow("401") << 401 << QByteArray("\"Invalid credentials\"");
    }

    void timerStateRefusedPausesAuthentication()
    {
        QFETCH(int, status);
        QFETCH(QByteArray, body);
        Fixture f;
        QVERIFY(connectAccount(f));
        QSignalSpy accountChanged(&f.connection, &Connection::accountChanged);

        bool answered = false;
        f.connection.fetchTimerState([&](const auto &) {
            answered = true;
        });
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/app/timer"));
        f.transport.respondLast(FakeTransport::answer(status, body));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
        QVERIFY(f.connection.errorString().contains(QString::fromUtf8(body).remove(QLatin1Char('"'))));
        verifyCleared(f.connection);
        QVERIFY(accountChanged.count() >= 1);
        QVERIFY(!answered);

        const qsizetype sent = f.transport.requests.size();
        std::optional<TimerActionResult> write;
        f.connection.stopTimer(1, [&](const TimerActionResult &r) {
            write = r;
        });
        QTRY_VERIFY(write.has_value());
        QVERIFY(write->outcome == TimerActionResult::Outcome::Refused);
        QVERIFY(write->error.kind == ApiError::Kind::AuthenticationPaused);
        f.connection.refreshAccount();
        QTest::qWait(20);
        QCOMPARE(f.transport.requests.size(), sent);

        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), sent + 1);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
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
        f.transport.respondLast(FakeTransport::answer(429, "\"Too many failed login attempts, try again later\"", "120"));
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        QCOMPARE(f.connection.rateLimitedUntil(), f.clock.now().addSecs(120));
        QVERIFY(f.connection.errorString().contains(QLatin1String("Too many")));
        QVERIFY(!f.connection.canWrite());

        // Nothing is sent during the cooldown, even on explicit reconnect.
        // The wait runs on the connection's clock.
        f.clock.advance(119000);
        f.connection.refreshAccount();
        f.connection.reconnect();
        QTest::qWait(10);
        QCOMPARE(f.transport.requests.size(), 1);
        QCOMPARE(f.connection.state(), Connection::RateLimited);

        f.clock.advance(1000);
        QVERIFY(!f.connection.rateLimitedUntil().isValid());
        QTRY_COMPARE(f.transport.requests.size(), 2);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(!f.connection.rateLimitedUntil().isValid());
    }

    void rateLimitWithoutRetryAfter()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        std::optional<ApiResult<ProjectList>> limited;
        f.connection.fetchProjects([&](const auto &r) {
            limited = r;
        });
        f.transport.respondLast(FakeTransport::answer(429, "\"Too many failed login attempts, try again later\""));
        QVERIFY(limited && limited->error.kind == ApiError::Kind::RateLimited);
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        QVERIFY(f.connection.isConnected());
        QVERIFY(!f.connection.canWrite());
        QCOMPARE(f.clock.now().msecsTo(f.connection.rateLimitedUntil()), Cooldown::defaultMs);

        const qsizetype sent = f.transport.requests.size();
        std::optional<ApiResult<TimerState>> refused;
        f.connection.fetchTimerState([&](const auto &r) {
            refused = r;
        });
        QTRY_VERIFY(refused.has_value());
        QVERIFY(refused->error.kind == ApiError::Kind::RateLimited);
        QCOMPARE(f.transport.requests.size(), sent);
    }

    // Otherwise a clock set far back would block for the time it went back.
    void rateLimitEndsWhenTheClockIsSetBack()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.connection.fetchProjects();
        f.transport.respondLast(FakeTransport::answer(429, "\"Too many requests\"", "120"));
        QCOMPARE(f.connection.state(), Connection::RateLimited);
        f.clock.advance(-2 * Cooldown::maxMs);
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(!f.connection.rateLimitedUntil().isValid());
        QVERIFY(f.connection.canWrite());
    }

    void unavailableWithRetryAfterCoolsDown()
    {
        {
            Fixture f;
            QVERIFY(connectAccount(f));
            std::optional<ApiResult<ProjectList>> refused;
            f.connection.fetchProjects([&](const auto &r) {
                refused = r;
            });
            f.transport.respondLast(FakeTransport::answer(503, "\"Report queue is full\"", "120"));
            QVERIFY(refused && refused->error.kind == ApiError::Kind::Server);
            QCOMPARE(f.connection.state(), Connection::RateLimited);
            QVERIFY(f.connection.isConnected());
            QVERIFY(!f.connection.canWrite());
            QCOMPARE(f.clock.now().msecsTo(f.connection.rateLimitedUntil()), 120000);
            const qsizetype sent = f.transport.requests.size();
            f.connection.fetchTimerState();
            QTest::qWait(10);
            QCOMPARE(f.transport.requests.size(), sent);
        }
        {
            Fixture f;
            f.store.secrets.insert(tokenKey(), token);
            f.connection.setInstanceUrl(instance);
            QTRY_COMPARE(f.transport.requests.size(), 1);
            f.transport.respondLast(FakeTransport::answer(503, QByteArray(), "1"));
            QCOMPARE(f.connection.state(), Connection::RateLimited);
            f.clock.advance(1000);
            QTRY_COMPARE(f.transport.requests.size(), 2);
            f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
            QCOMPARE(f.connection.state(), Connection::Connected);
        }
        {
            Fixture f;
            f.transport.status = FakeTransport::answer(503, QByteArray(), "60");
            f.store.secrets.insert(tokenKey(), token);
            f.connection.setInstanceUrl(instance);
            QTRY_COMPARE(f.connection.state(), Connection::RateLimited);
            QVERIFY(f.transport.requests.isEmpty());
        }
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

        {
            Fixture f;
            QVERIFY(connectAccount(f));
            f.connection.fetchTimerState();
            f.transport.respondLast(response);
            QCOMPARE(f.connection.state(), Connection::Disconnected);
            QVERIFY(f.connection.isStale());
            QVERIFY(f.connection.isConnected());
            QVERIFY(f.connection.canWrite());

            f.connection.fetchTimerState();
            f.transport.respondLast(FakeTransport::answer(200, stateBody()));
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
        const quint64 generation = f.connection.generation();

        f.connection.fetchTimerState();
        QPointer<FakeReply> pending = f.transport.replies.last();

        f.connection.setInstanceUrl(QStringLiteral("https://other.example.test"));
        verifyCleared(f.connection);
        QVERIFY(f.connection.generation() > generation);
        QVERIFY(pending && pending->aborted);

        pending->deliver(FakeTransport::answer(200, stateBody()));
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
        f.store.secrets.insert(passwordKey(QStringLiteral("bea@example.test")), password);
        f.connection.setAuthModeString(QStringLiteral("password"));
        f.connection.setEmail(QStringLiteral("bea@example.test"));
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));

        f.connection.fetchProjects();
        QPointer<FakeReply> pending = f.transport.replies.last();
        if (change == QLatin1String("mode")) {
            f.connection.setAuthModeString(QStringLiteral("token"));
        } else if (change == QLatin1String("email")) {
            f.connection.setEmail(QStringLiteral("cai@example.test"));
        } else {
            f.store.write(passwordKey(QStringLiteral("bea@example.test")), QStringLiteral("new-pw"), &f.store, [](const CredentialResult &) {});
        }
        verifyCleared(f.connection);
        QVERIFY(pending && pending->aborted);
        pending->deliver(FakeTransport::answer(200, projectsBody(7)));
        verifyCleared(f.connection);

        if (change == QLatin1String("secret")) {
            QTRY_COMPARE(f.transport.requests.size(), 3);
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

        oldMe->deliver(FakeTransport::answer(200, meWithToken(3, 7)));
        QVERIFY(!f.connection.isConnected());
        QCOMPARE(f.connection.state(), Connection::Connecting);

        f.transport.respondLast(FakeTransport::answer(200, meWithToken(8, 12)));
        QCOMPARE(f.connection.workspaceId(), 12);
        QCOMPARE(f.connection.account()->id, 8);
    }

    void staleCallbacksDoNotRun()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        bool called = false;
        f.connection.fetchTimerState([&](const auto &) {
            called = true;
        });
        QPointer<FakeReply> pending = f.transport.replies.last();
        f.connection.setEmail(QStringLiteral("ignored-in-token-mode@example.test"));
        f.connection.setAuthModeString(QStringLiteral("password"));
        pending->deliver(FakeTransport::answer(200, stateBody()));
        QTest::qWait(10);
        QVERIFY(!called);
    }

    void identityChangeOnRevalidation()
    {
        Fixture f;
        QVERIFY(connectAccount(f, 3, 7));
        const quint64 generation = f.connection.generation();
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(4, 8)));
        QVERIFY(f.connection.generation() > generation);
        QCOMPARE(f.connection.workspaceId(), 8);
    }

    void currentServerAnnouncesTheAppRoutes()
    {
        Fixture f;
        f.transport.holdStatus = true;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.statusRequests.size(), 1);
        QCOMPARE(f.transport.statusRequests.first().method, QByteArray("GET"));
        QCOMPARE(f.transport.statusRequests.first().url.toString(), QStringLiteral("https://example.test/tokkl/api/app/status"));

        QTest::qWait(10);
        QVERIFY(f.transport.requests.isEmpty());
        QCOMPARE(f.connection.state(), Connection::Connecting);
        QVERIFY(!f.connection.canWrite());
        QCOMPARE(f.connection.server(), ServerApi());

        f.transport.respondStatus(0, FakeTransport::currentStatus());
        QCOMPARE(f.transport.requests.size(), 1);
        QCOMPARE(path(f.transport.requests.first()), QStringLiteral("/tokkl/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        const ServerApi server = f.connection.server();
        QCOMPARE(server.version, 1);
        QVERIFY(server.isSupported());

        f.connection.fetchPreferences();
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/app/me/preferences"));
    }

    void olderServerIsRefused_data()
    {
        QTest::addColumn<HttpResponse>("status");
        QJsonObject partial = currentServerApi();
        partial.insert(QStringLiteral("capabilities"), QJsonArray{QStringLiteral("app-preferences"), QStringLiteral("timer-actions"), QStringLiteral("timer-edit")});
        QTest::newRow("no announcement") << FakeTransport::olderStatus();
        QTest::newRow("some capabilities") << FakeTransport::answer(200, QJsonDocument(partial).toJson(QJsonDocument::Compact));
        QTest::newRow("not found") << FakeTransport::answer(404, "\"Not found\"");
        QTest::newRow("not JSON") << FakeTransport::answer(200, "<html></html>");
    }

    // /me still goes out, so a wrong address or refused credentials say so.
    void olderServerIsRefused()
    {
        QFETCH(HttpResponse, status);
        Fixture f;
        f.transport.status = status;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        QCOMPARE(f.transport.statusRequests.size(), 1);
        QJsonObject me = QJsonDocument::fromJson(meWithToken(3, 7)).object();
        me.insert(QStringLiteral("api_version"), 1);
        me.insert(QStringLiteral("capabilities"), currentServerApi().value(QStringLiteral("capabilities")));
        f.transport.respondLast(FakeTransport::answer(200, QJsonDocument(me).toJson(QJsonDocument::Compact)));
        QCOMPARE(f.connection.state(), Connection::Error);
        QCOMPARE(f.connection.errorString(), QStringLiteral("This Tokkl server is too old for this app; update the server."));
        verifyCleared(f.connection);
        QCOMPARE(f.connection.server(), ServerApi());
        QTest::qWait(10);
        QCOMPARE(f.transport.requests.size(), 1);

        f.transport.status = FakeTransport::currentStatus();
        f.connection.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), 2);
        QCOMPARE(f.transport.statusRequests.size(), 2);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.server().isSupported());
    }

    void refusedCredentialsOutrankAnOlderServer()
    {
        Fixture f;
        f.transport.status = FakeTransport::olderStatus();
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(f.connection.state(), Connection::AuthenticationFailed);
    }

    void statusFailureFailsTheValidation_data()
    {
        QTest::addColumn<HttpResponse>("status");
        QTest::addColumn<int>("state");
        QTest::newRow("no answer") << FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable"))
                                   << int(Connection::Disconnected);
        QTest::newRow("timeout") << FakeTransport::failure(HttpResponse::Outcome::Timeout) << int(Connection::Disconnected);
        QTest::newRow("server error") << FakeTransport::answer(502, QByteArray()) << int(Connection::Disconnected);
        QTest::newRow("rate limited") << FakeTransport::answer(429, "\"Too many requests\"", "120") << int(Connection::RateLimited);
    }

    void statusFailureFailsTheValidation()
    {
        QFETCH(HttpResponse, status);
        QFETCH(int, state);
        Fixture f;
        f.transport.status = status;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.statusRequests.size(), 1);
        QTRY_COMPARE(int(f.connection.state()), state);
        QVERIFY(f.transport.requests.isEmpty());
        QVERIFY(!f.connection.isConnected());
    }

    // 30 s, doubling per failure in a row up to 2 min, plus jitter; 30 s after a success.
    void accountRetriesBackOffWithTheClocksJitter()
    {
        FakeClock clock;
        RetryBackoff retry(Connection::retryBaseMs, Connection::retryMaxMs);
        QCOMPARE(retry.next(clock), 30000);
        QCOMPARE(retry.next(clock), 60000);
        QCOMPARE(retry.next(clock), 120000);
        QCOMPARE(retry.next(clock), 120000);
        clock.jitter = 40000;
        QCOMPARE(retry.next(clock), 120000 + 29999);
        retry.reset();
        QCOMPARE(retry.next(clock), 30000 + 7499);
        clock.jitter = 1000;
        QCOMPARE(retry.next(clock), 61000);
    }

    void statusAskedAgainAfterANetworkFailure()
    {
        Fixture f;
        f.transport.status = FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable"));
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.connection.state(), Connection::Disconnected);
        QCOMPARE(f.transport.statusRequests.size(), 1);
        QVERIFY(f.transport.requests.isEmpty());

        f.transport.status = FakeTransport::currentStatus();
        f.connection.refreshAccount();
        QTRY_COMPARE(f.transport.requests.size(), 1);
        QCOMPARE(f.transport.statusRequests.size(), 2);
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.server().isSupported());

        f.connection.refreshAccount();
        QTRY_COMPARE(f.transport.requests.size(), 2);
        QCOMPARE(path(f.transport.requests.last()), QStringLiteral("/tokkl/api/v9/me"));
        QCOMPARE(f.transport.statusRequests.size(), 2);
    }

    void statusIsReadOncePerGeneration()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QCOMPARE(f.transport.statusRequests.size(), 1);

        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(4, 8)));
        QCOMPARE(f.connection.workspaceId(), 8);
        QVERIFY(f.connection.server().isSupported());
        QTest::qWait(10);
        QCOMPARE(f.transport.statusRequests.size(), 1);

        f.transport.status = FakeTransport::olderStatus();
        f.store.secrets.insert(tokenKey(QStringLiteral("https://other.example.test")), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(QStringLiteral("https://other.example.test"));
        QCOMPARE(f.connection.server(), ServerApi());
        QTRY_COMPARE(f.transport.requests.size(), before + 1);
        QCOMPARE(f.transport.statusRequests.size(), 2);
        QCOMPARE(f.transport.statusRequests.last().url.toString(), QStringLiteral("https://other.example.test/api/app/status"));
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Error);
        QCOMPARE(f.connection.server(), ServerApi());
    }

    void statusInFlight()
    {
        Fixture f;
        f.transport.holdStatus = true;
        f.store.secrets.insert(tokenKey(), token);
        f.connection.setInstanceUrl(instance);
        QTRY_COMPARE(f.transport.statusRequests.size(), 1);
        f.connection.refreshAccount();
        QVERIFY(f.transport.requests.isEmpty());

        f.store.secrets.insert(tokenKey(QStringLiteral("https://other.example.test")), token);
        f.connection.setInstanceUrl(QStringLiteral("https://other.example.test"));
        QVERIFY(f.transport.statusReplies.first()->aborted);
        QTRY_COMPARE(f.transport.statusRequests.size(), 2);
        f.transport.respondStatus(0, FakeTransport::currentStatus());
        QVERIFY(f.transport.requests.isEmpty());

        f.transport.respondStatus(1, FakeTransport::currentStatus());
        QCOMPARE(f.transport.requests.size(), 1);
        QCOMPARE(f.transport.requests.first().url.toString(), QStringLiteral("https://other.example.test/api/v9/me"));
        f.transport.respondLast(FakeTransport::answer(200, meWithToken(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QVERIFY(f.connection.server().isSupported());
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

    void setupSavesAndLoadsSecrets()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        ConnectionSetup setup(&transport, &store);

        setup.setAccount(instance + QLatin1Char('/'), QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("  ") + token + QStringLiteral("\n"));
        setup.saveSecret();
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

    // A settings window waits for the store before closing.
    void setupReportsWhenTheSecretIsSaved()
    {
        FakeTransport transport;
        FakeCredentialStore store;
        ConnectionSetup setup(&transport, &store);
        QList<bool> results;
        const auto record = [&results](bool saved) {
            results.append(saved);
        };

        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.saveSecret(this, record);
        QCOMPARE(results, QList<bool>{true});
        QCOMPARE(store.writes, 0);

        results.clear();
        setup.editSecret(token);
        setup.saveSecret(this, record);
        QVERIFY(results.isEmpty());
        QTRY_COMPARE(results, QList<bool>{true});
        QCOMPARE(store.secrets.value(tokenKey()), token);
        QCOMPARE(setup.walletError(), QString());
        QVERIFY(!setup.isBusy());

        results.clear();
        setup.saveSecret(this, record);
        QCOMPARE(results, QList<bool>{true});
        QCOMPARE(store.writes, 1);

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
    }

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

        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        setup.setAccount(QStringLiteral("https://other.example.test"), QStringLiteral("token"), QString());
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(store.reads, 1);
        QCOMPARE(setup.secret(), QString());
        setup.saveSecret();
        QCOMPARE(store.writes, 0);

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
        transport.respondLast(FakeTransport::answer(200, meWithToken(4, 9)));

        setup.saveSecret();
        QTRY_COMPARE(store.secrets.value(tokenKey(other)), typed);
        QCOMPARE(store.secrets.value(tokenKey()), token);

        setup.editSecret(QStringLiteral("replacement"));
        setup.saveSecret();
        setup.setAccount(instance, QStringLiteral("token"), QString());
        QCOMPARE(setup.secret(), QString());
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(store.secrets.value(tokenKey(other)), QStringLiteral("replacement"));
        QCOMPARE(store.secrets.value(tokenKey()), token);

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
        transport.respondLast(FakeTransport::answer(200, meWithToken(3, 42)));
        QCOMPARE(setup.testResult(), ConnectionSetup::Succeeded);
        QVERIFY(setup.testMessage().contains(QLatin1String("42")));
        QVERIFY(!setup.isBusy());
        QCOMPARE(store.reads + store.writes, 0);

        setup.testConnection(instance, QStringLiteral("password"), QStringLiteral("bea@example.test"), password);
        QCOMPARE(transport.requests.last().authorization, QByteArray("Basic ") + QByteArray("bea@example.test:hunter2-pw").toBase64());
        transport.respondLast(FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QCOMPARE(setup.testResult(), ConnectionSetup::Failed);
        QVERIFY(setup.testMessage().contains(QLatin1String("Incorrect username and/or password")));
        QVERIFY(!setup.testMessage().contains(password));

        setup.testConnection(instance, QStringLiteral("token"), QString(), token);
        QPointer<FakeReply> older = transport.replies.last();
        setup.testConnection(instance, QStringLiteral("token"), QString(), QStringLiteral("second"));
        QVERIFY(older->aborted);
        older->deliver(FakeTransport::answer(200, meWithToken(3, 7)));
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

    // The cases of insecureurls.json, which the GNOME extension also follows.
    void setupFlagsPlainHttp_data()
    {
        QTest::addColumn<QString>("url");
        QTest::addColumn<bool>("insecure");
        QFile file(QStringLiteral(TOKKL_INSECURE_URLS));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QJsonArray cases = QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("cases")).toArray();
        QVERIFY(cases.size() > 10);
        for (const QJsonValue &value : cases) {
            const QJsonObject item = value.toObject();
            const QString url = item.value(QStringLiteral("url")).toString();
            QTest::newRow(qPrintable(url.isEmpty() ? QStringLiteral("(empty)") : url)) << url << item.value(QStringLiteral("insecure")).toBool();
        }
    }

    void setupFlagsPlainHttp()
    {
        QFETCH(QString, url);
        QFETCH(bool, insecure);
        ConnectionSetup setup(nullptr, nullptr);
        QCOMPARE(setup.isInsecure(url), insecure);
    }

    void setupRefusesUserInfo()
    {
        ConnectionSetup setup(nullptr, nullptr);
        QVERIFY(setup.urlError(QStringLiteral("https://u:p@example.test")).contains(QLatin1String("user name")));
        QCOMPARE(setup.urlError(instance), QString());
    }

    void setupPersistsOnlyAValidatedUrl()
    {
        ConnectionSetup setup(nullptr, nullptr);
        QCOMPARE(setup.persistedUrl(QStringLiteral(" HTTPS://Example.test:443/tokkl/ ")), instance);
        QCOMPARE(setup.persistedUrl(QStringLiteral("http://127.0.0.1:8080/")), QStringLiteral("http://127.0.0.1:8080"));
        QCOMPARE(setup.persistedUrl(instance), instance);
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
