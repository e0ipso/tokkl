// Instance URLs, Basic credentials and the API's JSON shapes.

#include "apitypes.h"
#include "instanceurl.h"
#include "transport.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

using namespace Tokkl;

class ApiTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void instanceUrls_data()
    {
        QTest::addColumn<QString>("input");
        QTest::addColumn<QString>("meUrl"); // empty when the input is refused

        QTest::newRow("plain host") << "https://tokkl.example.com" << "https://tokkl.example.com/api/v9/me";
        QTest::newRow("trailing slash") << "https://tokkl.example.com/" << "https://tokkl.example.com/api/v9/me";
        QTest::newRow("path prefix") << "https://example.com/apps/tokkl" << "https://example.com/apps/tokkl/api/v9/me";
        QTest::newRow("path prefix with slashes") << "  https://example.com/apps/tokkl//  " << "https://example.com/apps/tokkl/api/v9/me";
        QTest::newRow("encoded prefix") << "https://example.com/my%20tokkl" << "https://example.com/my%20tokkl/api/v9/me";
        QTest::newRow("http with port") << "http://192.168.1.5:8080" << "http://192.168.1.5:8080/api/v9/me";
        QTest::newRow("default port dropped") << "HTTPS://Example.COM:443/t" << "https://example.com/t/api/v9/me";
        QTest::newRow("blank") << "   " << "";
        QTest::newRow("no scheme") << "tokkl.example.com" << "";
        QTest::newRow("ftp") << "ftp://tokkl.example.com" << "";
        QTest::newRow("user info") << "https://me:secret@tokkl.example.com" << "";
        QTest::newRow("query") << "https://tokkl.example.com/?a=1" << "";
        QTest::newRow("fragment") << "https://tokkl.example.com/#x" << "";
    }

    void instanceUrls()
    {
        QFETCH(QString, input);
        QFETCH(QString, meUrl);
        const InstanceUrl instance = parseInstanceUrl(input);
        if (meUrl.isEmpty()) {
            QVERIFY(!instance.isValid());
            QVERIFY(!instance.error.isEmpty());
            QVERIFY(!instance.error.contains(QLatin1String("secret")));
            return;
        }
        QVERIFY2(instance.isValid(), qPrintable(instance.error));
        QCOMPARE(instance.api(QStringLiteral("/me")).toString(QUrl::FullyEncoded), meUrl);
    }

    void apiQuery()
    {
        const InstanceUrl instance = parseInstanceUrl(QStringLiteral("https://example.com/tokkl"));
        QCOMPARE(instance.api(QStringLiteral("/workspaces/7/projects?active=true")).toString(QUrl::FullyEncoded),
                 QStringLiteral("https://example.com/tokkl/api/v9/workspaces/7/projects?active=true"));
    }

    void basicAuthorization()
    {
        QCOMPARE(Tokkl::basicAuthorization(AuthMode::Token, QString(), QStringLiteral("abc123")), QByteArray("Basic ") + QByteArray("abc123:api_token").toBase64());
        QCOMPARE(Tokkl::basicAuthorization(AuthMode::Password, QStringLiteral(" Ann@Example.com "), QStringLiteral("p:ss word")),
                 QByteArray("Basic ") + QByteArray("Ann@Example.com:p:ss word").toBase64());
    }

    void credentialKeys()
    {
        const InstanceUrl a = parseInstanceUrl(QStringLiteral("https://example.com/tokkl/"));
        const InstanceUrl b = parseInstanceUrl(QStringLiteral("https://example.com/other"));
        QCOMPARE(credentialKey(a, AuthMode::Token, QStringLiteral("x@y")), credentialKey(a, AuthMode::Token, QString()));
        QVERIFY(credentialKey(a, AuthMode::Token, QString()) != credentialKey(b, AuthMode::Token, QString()));
        QVERIFY(credentialKey(a, AuthMode::Token, QString()) != credentialKey(a, AuthMode::Password, QStringLiteral("x@y")));
        // Accounts are keyed like the server keys them: ASCII case folded only.
        QCOMPARE(credentialKey(a, AuthMode::Password, QStringLiteral(" Ann@Example.com")), credentialKey(a, AuthMode::Password, QStringLiteral("ann@example.com")));
        QVERIFY(credentialKey(a, AuthMode::Password, QStringLiteral("Ä@x")) != credentialKey(a, AuthMode::Password, QStringLiteral("ä@x")));
    }

    void bareBodies()
    {
        QVERIFY(parseJsonBody("null")->isNull());
        QCOMPARE(parseJsonBody("\"Incorrect username and/or password\"")->toString(), QStringLiteral("Incorrect username and/or password"));
        QVERIFY(parseJsonBody("[1,2]")->isArray());
        QVERIFY(parseJsonBody("{\"a\":1}")->isObject());
        QVERIFY(!parseJsonBody("").has_value());
        QVERIFY(!parseJsonBody("1,2").has_value());
        QVERIFY(!parseJsonBody("<html>").has_value());
        QVERIFY(!parseJsonBody("null] [").has_value());
    }

    void decodeMe()
    {
        const QByteArray body = R"({"id":3,"api_token":"SECRET","email":"b@example.com","fullname":"Bea","timezone":"Europe/Madrid",
                                    "default_workspace_id":9,"beginning_of_week":1})";
        const std::optional<Me> me = Tokkl::decodeMe(*parseJsonBody(body));
        QVERIFY(me);
        QCOMPARE(me->id, 3);
        QCOMPARE(me->defaultWorkspaceId, 9);
        QCOMPARE(me->fullname, QStringLiteral("Bea"));
        // The token in the response is never kept.
        QVERIFY(!me->toVariantMap().values().contains(QVariant(QStringLiteral("SECRET"))));

        QVERIFY(!Tokkl::decodeMe(*parseJsonBody(R"({"id":3,"email":"b@example.com"})")));
        QVERIFY(!Tokkl::decodeMe(*parseJsonBody(R"({"id":3,"email":"b@example.com","default_workspace_id":0})")));
        QVERIFY(!Tokkl::decodeMe(*parseJsonBody(R"({"id":"3","email":"b@example.com","default_workspace_id":9})")));
        QVERIFY(!Tokkl::decodeMe(*parseJsonBody("null")));
        QVERIFY(!Tokkl::decodeMe(*parseJsonBody("[]")));
    }

    void decodeMeTimeResolution_data()
    {
        QTest::addColumn<QByteArray>("field"); // added to a valid body
        QTest::addColumn<int>("minutes");

        QTest::newRow("present") << QByteArray(R"(,"time_resolution_minutes":15)") << 15;
        QTest::newRow("missing") << QByteArray() << 1;
        QTest::newRow("does not divide an hour") << QByteArray(R"(,"time_resolution_minutes":7)") << 1;
        QTest::newRow("zero") << QByteArray(R"(,"time_resolution_minutes":0)") << 1;
        QTest::newRow("string") << QByteArray(R"(,"time_resolution_minutes":"15")") << 1;
    }

    // An invalid resolution does not refuse the account.
    void decodeMeTimeResolution()
    {
        QFETCH(QByteArray, field);
        QFETCH(int, minutes);
        const std::optional<Me> me = Tokkl::decodeMe(*parseJsonBody(R"({"id":3,"email":"b@example.com","default_workspace_id":9)" + field + "}"));
        QVERIFY(me);
        QCOMPARE(me->timeResolutionMinutes, minutes);
        QCOMPARE(me->toVariantMap().value(QStringLiteral("timeResolutionMinutes")), QVariant(minutes));
    }

    void decodeEntries()
    {
        const QByteArray running = R"({"id":5,"workspace_id":9,"project_id":null,"task_id":null,"billable":false,
            "start":"2026-10-16T08:00:00+00:00","stop":null,"duration":-1792137600,"description":"","tags":[],"tag_ids":[]})";
        const auto current = decodeCurrentEntry(*parseJsonBody(running));
        QVERIFY(current);
        QVERIFY(current->has_value());
        QCOMPARE((*current)->id, 5);
        QVERIFY((*current)->isRunning());
        QVERIFY(!(*current)->projectId);
        QCOMPARE((*current)->start, QDateTime(QDate(2026, 10, 16), QTime(8, 0), QTimeZone::UTC));

        const auto none = decodeCurrentEntry(*parseJsonBody("null"));
        QVERIFY(none);
        QVERIFY(!none->has_value());

        const QByteArray stopped = R"({"id":6,"workspace_id":9,"project_id":4,"billable":true,"start":"2026-10-16T08:00:00Z",
            "stop":"2026-10-16T09:30:00Z","duration":5400,"description":"Deep work","tags":["a","b"]})";
        const auto entry = decodeTimeEntry(*parseJsonBody(stopped));
        QVERIFY(entry);
        QVERIFY(!entry->isRunning());
        QCOMPARE(entry->projectId.value_or(0), 4);
        QCOMPARE(entry->tags, QStringList({QStringLiteral("a"), QStringLiteral("b")}));

        QVERIFY(!decodeCurrentEntry(*parseJsonBody("[]")));
        QVERIFY(!decodeTimeEntry(*parseJsonBody(R"({"id":6,"workspace_id":9,"start":"yesterday","duration":1})")));
        QVERIFY(!decodeTimeEntry(*parseJsonBody(R"({"id":6,"workspace_id":9,"start":"2026-10-16T08:00:00Z","duration":1,"tags":[1]})")));
    }

    void decodeProjects()
    {
        const QByteArray body = R"([{"id":1,"workspace_id":9,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true},
                                    {"id":2,"workspace_id":9,"client_id":3,"client_name":"Acme","name":"Beta","color":"#c56bff","active":true,"billable":false}])";
        const auto projects = Tokkl::decodeProjects(*parseJsonBody(body));
        QVERIFY(projects);
        QCOMPARE(projects->size(), 2);
        QCOMPARE(projects->at(1).clientId.value_or(0), 3);
        QCOMPARE(projects->at(1).clientName, QStringLiteral("Acme"));
        QVERIFY(Tokkl::decodeProjects(*parseJsonBody("[]"))->isEmpty());
        QVERIFY(!Tokkl::decodeProjects(*parseJsonBody("null")));
        QVERIFY(!Tokkl::decodeProjects(*parseJsonBody(R"([{"id":1}])")));
    }

    void errors_data()
    {
        QTest::addColumn<int>("status");
        QTest::addColumn<QByteArray>("body");
        QTest::addColumn<int>("kind");
        QTest::addColumn<QString>("message");

        QTest::newRow("403") << 403 << QByteArray("\"Incorrect username and/or password\"") << int(ApiError::Kind::Forbidden)
                             << QStringLiteral("Incorrect username and/or password");
        QTest::newRow("401") << 401 << QByteArray() << int(ApiError::Kind::Unauthorized) << QString();
        QTest::newRow("429") << 429 << QByteArray("\"Too many failed login attempts, try again later\"") << int(ApiError::Kind::RateLimited)
                             << QStringLiteral("Too many failed login attempts, try again later");
        QTest::newRow("400") << 400 << QByteArray("\"Invalid request body\"") << int(ApiError::Kind::Client) << QStringLiteral("Invalid request body");
        QTest::newRow("502 html") << 502 << QByteArray("<html>Bad gateway</html>") << int(ApiError::Kind::Server) << QString();
        QTest::newRow("301") << 301 << QByteArray() << int(ApiError::Kind::Redirect) << QString();
    }

    void errors()
    {
        QFETCH(int, status);
        QFETCH(QByteArray, body);
        QFETCH(int, kind);
        QFETCH(QString, message);
        HttpResponse response;
        response.outcome = HttpResponse::Outcome::Finished;
        response.status = status;
        response.body = body;
        const ApiError error = errorFromResponse(response);
        QCOMPARE(int(error.kind), kind);
        QCOMPARE(error.status, status);
        QVERIFY(!error.message.isEmpty());
        if (!message.isEmpty()) {
            QCOMPARE(error.message, message);
        }
        QVERIFY(!error.message.contains(QLatin1String("<html>")));
    }

    void transportFailures()
    {
        HttpResponse timeout;
        timeout.outcome = HttpResponse::Outcome::Timeout;
        QVERIFY(errorFromResponse(timeout).kind == ApiError::Kind::Timeout);
        QVERIFY(errorFromResponse(timeout).isTransient());

        HttpResponse refused;
        refused.outcome = HttpResponse::Outcome::NetworkError;
        refused.errorString = QStringLiteral("Connection refused");
        QVERIFY(errorFromResponse(refused).kind == ApiError::Kind::Network);
        QVERIFY(errorFromResponse(refused).message.contains(QLatin1String("Connection refused")));
    }

    void redirectsHideCredentials()
    {
        HttpResponse response;
        response.outcome = HttpResponse::Outcome::Finished;
        response.status = 302;
        response.location = "https://user:pass@elsewhere.example/login?token=abc";
        const QString message = errorFromResponse(response).message;
        QVERIFY(message.contains(QLatin1String("https://elsewhere.example")));
        QVERIFY(!message.contains(QLatin1String("pass")));
        QVERIFY(!message.contains(QLatin1String("token")));
    }

    void encodeStart()
    {
        StartEntry entry;
        entry.start = QDateTime(QDate(2026, 10, 16), QTime(8, 0), QTimeZone::fromSecondsAheadOfUtc(7200));
        entry.projectId = 4;
        entry.billable = true;
        const QJsonObject body = QJsonDocument::fromJson(encodeStartEntry(entry, 9, QStringLiteral("tokkl-test"))).object();
        QCOMPARE(body.value(QLatin1String("workspace_id")).toInteger(), 9);
        QCOMPARE(body.value(QLatin1String("duration")).toInteger(), -1);
        QCOMPARE(body.value(QLatin1String("created_with")).toString(), QStringLiteral("tokkl-test"));
        QCOMPARE(body.value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T06:00:00Z"));
        QCOMPARE(body.value(QLatin1String("project_id")).toInteger(), 4);
        QCOMPARE(body.value(QLatin1String("billable")).toBool(), true);
        QCOMPARE(body.value(QLatin1String("description")).toString(), QString());

        StartEntry bare;
        bare.start = QDateTime::currentDateTimeUtc();
        const QJsonObject bareBody = QJsonDocument::fromJson(encodeStartEntry(bare, 9, QStringLiteral("tokkl-test"))).object();
        QVERIFY(bareBody.value(QLatin1String("project_id")).isNull());
        QVERIFY(!bareBody.contains(QLatin1String("billable")));
    }

    void encodeUpdate()
    {
        TimeEntryUpdate update;
        QCOMPARE(encodeTimeEntryUpdate(update), QByteArray("{}"));
        update.projectId = std::optional<qint64>();
        update.description = QStringLiteral("x");
        const QJsonObject body = QJsonDocument::fromJson(encodeTimeEntryUpdate(update)).object();
        QVERIFY(body.contains(QLatin1String("project_id")));
        QVERIFY(body.value(QLatin1String("project_id")).isNull());
        QCOMPARE(body.value(QLatin1String("description")).toString(), QStringLiteral("x"));
        QVERIFY(!body.contains(QLatin1String("billable")));
        QVERIFY(!body.contains(QLatin1String("task_id")));

        update.taskId = std::optional<qint64>();
        const QJsonObject cleared = QJsonDocument::fromJson(encodeTimeEntryUpdate(update)).object();
        QVERIFY(cleared.contains(QLatin1String("task_id")));
        QVERIFY(cleared.value(QLatin1String("task_id")).isNull());
    }
};

QTEST_GUILESS_MAIN(ApiTest)

#include "apitest.moc"
