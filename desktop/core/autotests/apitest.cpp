// Instance URLs, Basic credentials and the API's JSON shapes.

#include "apitypes.h"
#include "instanceurl.h"
#include "transport.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>
#include <QTimeZone>

using namespace Tokkl;

namespace
{
// A state with a running Pomodoro session, as GET /api/app/timer sends it.
QJsonObject sessionState()
{
    const QJsonObject entry{
        {QStringLiteral("id"), 41},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("project_id"), 11},
        {QStringLiteral("task_id"), QJsonValue::Null},
        {QStringLiteral("billable"), true},
        {QStringLiteral("start"), QStringLiteral("2026-10-16T08:50:00.000Z")},
        {QStringLiteral("stop"), QJsonValue::Null},
        {QStringLiteral("duration"), -1792140600},
        {QStringLiteral("description"), QStringLiteral("Write the report")},
        {QStringLiteral("tags"), QJsonArray{QStringLiteral("focus")}},
        {QStringLiteral("tag_ids"), QJsonArray{3}},
        {QStringLiteral("at"), QStringLiteral("2026-10-16T08:50:00.000Z")},
        {QStringLiteral("server_deleted_at"), QJsonValue::Null},
        {QStringLiteral("project_name"), QStringLiteral("Alpha")},
    };
    const QJsonObject phase{
        {QStringLiteral("kind"), QStringLiteral("shortRest")},
        {QStringLiteral("start"), QStringLiteral("2026-10-16T08:55:00.000Z")},
        {QStringLiteral("completed"), 1},
        {QStringLiteral("planned_end"), QStringLiteral("2026-10-16T09:00:00.000Z")},
    };
    const QJsonObject pomodoro{
        {QStringLiteral("work_minutes"), 25},
        {QStringLiteral("short_rest_minutes"), 5},
        {QStringLiteral("long_rest_minutes"), 15},
        {QStringLiteral("long_rest_every"), 4},
        {QStringLiteral("phase"), phase},
        {QStringLiteral("upcoming_phase"), QStringLiteral("work")},
        {QStringLiteral("transition"), QStringLiteral("shortRestToWork")},
        {QStringLiteral("number"), 1},
        {QStringLiteral("entry_id"), 41},
        {QStringLiteral("pomodoro_start"), QStringLiteral("2026-10-16T08:30:00.000Z")},
    };
    const QJsonObject discarded{
        {QStringLiteral("entry_id"), 40},
        {QStringLiteral("start"), QStringLiteral("2026-10-16T08:29:00.000Z")},
        {QStringLiteral("stop"), QStringLiteral("2026-10-16T08:29:00.000Z")},
    };
    return QJsonObject{
        {QStringLiteral("revision"), 12},
        {QStringLiteral("server_time"), QStringLiteral("2026-10-16T08:56:30.250Z")},
        {QStringLiteral("running_entry"), entry},
        {QStringLiteral("pause"), QJsonValue::Null},
        {QStringLiteral("pomodoro"), pomodoro},
        {QStringLiteral("discarded_pomodoro"), discarded},
    };
}

// A paused chain: nothing runs.
QJsonObject pausedState()
{
    QJsonObject state = sessionState();
    state.insert(QStringLiteral("running_entry"), QJsonValue::Null);
    state.insert(QStringLiteral("pomodoro"), QJsonValue::Null);
    state.insert(QStringLiteral("discarded_pomodoro"), QJsonValue::Null);
    state.insert(QStringLiteral("pause"),
                 QJsonObject{
                     {QStringLiteral("paused"), true},
                     {QStringLiteral("seconds"), 1500},
                     {QStringLiteral("workspace_id"), 7},
                     {QStringLiteral("description"), QStringLiteral("Write the report")},
                     {QStringLiteral("project_id"), 11},
                     {QStringLiteral("task_id"), QJsonValue::Null},
                     {QStringLiteral("tag_ids"), QJsonArray{3, 5}},
                     {QStringLiteral("tags"), QJsonArray{QStringLiteral("client"), QStringLiteral("focus")}},
                     {QStringLiteral("billable"), true},
                     {QStringLiteral("clone_entry_id"), QJsonValue::Null},
                 });
    return state;
}

// Replaces the value at a slash-separated path of object keys, or removes it
// when value is undefined.
QJsonValue withValue(const QJsonValue &root, QStringView path, const QJsonValue &value)
{
    const qsizetype slash = path.indexOf(QLatin1Char('/'));
    const QString key = path.left(slash).toString();
    QJsonObject object = root.toObject();
    if (slash < 0) {
        if (value.isUndefined()) {
            object.remove(key);
        } else {
            object.insert(key, value);
        }
    } else {
        object.insert(key, withValue(object.value(key), path.mid(slash + 1), value));
    }
    return object;
}

std::optional<TimerState> decodeText(const QByteArray &text)
{
    const std::optional<QJsonValue> value = parseJsonBody(text);
    return value ? decodeTimerState(*value) : std::nullopt;
}
}

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
    void appUrls()
    {
        const InstanceUrl instance = parseInstanceUrl(QStringLiteral("https://example.com/tokkl"));
        QCOMPARE(instance.app(QStringLiteral("/timer/events")).toString(QUrl::FullyEncoded), QStringLiteral("https://example.com/tokkl/api/app/timer/events"));
        QCOMPARE(parseInstanceUrl(QStringLiteral("http://127.0.0.1:8080")).app(QStringLiteral("/pomodoro/next")).toString(QUrl::FullyEncoded),
                 QStringLiteral("http://127.0.0.1:8080/api/app/pomodoro/next"));
    }

    void decodeTimerStates()
    {
        const std::optional<TimerState> session = decodeTimerState(sessionState());
        QVERIFY(session);
        QCOMPARE(session->revision, 12);
        QCOMPARE(session->serverTime, QDateTime(QDate(2026, 10, 16), QTime(8, 56, 30, 250), QTimeZone::UTC));
        QVERIFY(session->runningEntry);
        QCOMPARE(session->runningEntry->id, 41);
        QCOMPARE(session->runningEntry->projectId, std::optional<qint64>(11));
        QVERIFY(session->runningEntry->isRunning());
        QVERIFY(!session->pause);
        QVERIFY(session->pomodoro);
        const TimerPomodoro &pomodoro = *session->pomodoro;
        QCOMPARE(pomodoro.config, (PomodoroConfig{25, 5, 15, 4}));
        QVERIFY(pomodoro.phase.kind == PhaseKind::ShortRest);
        QCOMPARE(pomodoro.phase.start, QDateTime(QDate(2026, 10, 16), QTime(8, 55), QTimeZone::UTC));
        QCOMPARE(pomodoro.phase.completed, 1);
        QCOMPARE(pomodoro.phase.plannedEnd, QDateTime(QDate(2026, 10, 16), QTime(9, 0), QTimeZone::UTC));
        QVERIFY(pomodoro.upcomingPhase == PhaseKind::Work);
        QVERIFY(pomodoro.transition == TransitionKind::ShortRestToWork);
        QCOMPARE(pomodoro.number, 1);
        QCOMPARE(pomodoro.entryId, 41);
        QCOMPARE(pomodoro.pomodoroStart, QDateTime(QDate(2026, 10, 16), QTime(8, 30), QTimeZone::UTC));
        QVERIFY(session->discardedPomodoro);
        QCOMPARE(session->discardedPomodoro->entryId, 40);
        QCOMPARE(session->discardedPomodoro->stop, QDateTime(QDate(2026, 10, 16), QTime(8, 29), QTimeZone::UTC));

        const std::optional<TimerState> paused = decodeTimerState(pausedState());
        QVERIFY(paused);
        QVERIFY(!paused->runningEntry);
        QVERIFY(!paused->pomodoro);
        QVERIFY(!paused->discardedPomodoro);
        QVERIFY(paused->pause);
        QVERIFY(paused->pause->paused);
        QCOMPARE(paused->pause->seconds, 1500);
        QCOMPARE(paused->pause->workspaceId, 7);
        QCOMPARE(paused->pause->description, QStringLiteral("Write the report"));
        QCOMPARE(paused->pause->projectId, std::optional<qint64>(11));
        QCOMPARE(paused->pause->taskId, std::nullopt);
        QCOMPARE(paused->pause->tagIds, (QList<qint64>{3, 5}));
        QCOMPARE(paused->pause->tags, (QStringList{QStringLiteral("client"), QStringLiteral("focus")}));
        QVERIFY(paused->pause->billable);
        QCOMPARE(paused->pause->cloneEntryId, std::nullopt);

        // A user who never ran a timer is at revision 0.
        const std::optional<TimerState> idle = decodeText(R"({"revision":0,"server_time":"2026-10-16T09:00:00.000Z","running_entry":null,"pause":null,"pomodoro":null,"discarded_pomodoro":null})");
        QVERIFY(idle);
        QCOMPARE(idle->revision, 0);
        QVERIFY(!idle->runningEntry && !idle->pause && !idle->pomodoro && !idle->discardedPomodoro);
    }

    void timerStateIsStrict_data()
    {
        QTest::addColumn<QJsonValue>("state");

        const QJsonValue session = sessionState();
        const QJsonValue paused = pausedState();
        const QJsonValue undefined(QJsonValue::Undefined);
        QTest::newRow("not an object") << QJsonValue(QJsonArray{session});
        QTest::newRow("no revision") << withValue(session, u"revision", undefined);
        QTest::newRow("negative revision") << withValue(session, u"revision", -1);
        QTest::newRow("fractional revision") << withValue(session, u"revision", 1.5);
        QTest::newRow("revision as text") << withValue(session, u"revision", QStringLiteral("12"));
        QTest::newRow("no server time") << withValue(session, u"server_time", undefined);
        QTest::newRow("server time not a timestamp") << withValue(session, u"server_time", QStringLiteral("now"));
        QTest::newRow("no running entry key") << withValue(session, u"running_entry", undefined);
        QTest::newRow("running entry stopped") << withValue(session, u"running_entry/stop", QStringLiteral("2026-10-16T08:55:00.000Z"));
        QTest::newRow("running entry not an entry") << withValue(session, u"running_entry", QStringLiteral("41"));
        QTest::newRow("unknown phase") << withValue(session, u"pomodoro/phase/kind", QStringLiteral("nap"));
        QTest::newRow("unknown upcoming phase") << withValue(session, u"pomodoro/upcoming_phase", QStringLiteral("nap"));
        QTest::newRow("unknown transition") << withValue(session, u"pomodoro/transition", QStringLiteral("napToWork"));
        QTest::newRow("no planned end") << withValue(session, u"pomodoro/phase/planned_end", undefined);
        QTest::newRow("negative completed") << withValue(session, u"pomodoro/phase/completed", -1);
        QTest::newRow("zero work minutes") << withValue(session, u"pomodoro/work_minutes", 0);
        QTest::newRow("no session entry") << withValue(session, u"pomodoro/entry_id", 0);
        QTest::newRow("no pomodoro start") << withValue(session, u"pomodoro/pomodoro_start", undefined);
        QTest::newRow("discarded without stop") << withValue(session, u"discarded_pomodoro/stop", undefined);
        QTest::newRow("pause flag as text") << withValue(paused, u"pause/paused", QStringLiteral("true"));
        QTest::newRow("negative pause seconds") << withValue(paused, u"pause/seconds", -5);
        QTest::newRow("pause without workspace") << withValue(paused, u"pause/workspace_id", undefined);
        QTest::newRow("pause tag id as text") << withValue(paused, u"pause/tag_ids", QJsonArray{QStringLiteral("3")});
        QTest::newRow("pause tag not text") << withValue(paused, u"pause/tags", QJsonArray{3});
        QTest::newRow("pause clone id zero") << withValue(paused, u"pause/clone_entry_id", 0);
    }

    // Any value of the wrong shape refuses the whole state.
    void timerStateIsStrict()
    {
        QFETCH(QJsonValue, state);
        QVERIFY(!decodeTimerState(state));
    }

    void encodeTimerActions()
    {
        QCOMPARE(encodeRevision(12), QByteArray(R"({"revision":12})"));

        PomodoroStart start;
        start.projectId = 11;
        start.billable = true;
        const QJsonObject body = QJsonDocument::fromJson(encodePomodoroStart(start, 7, QStringLiteral("tokkl-test"))).object();
        QCOMPARE(body.value(QLatin1String("workspace_id")).toInteger(), 7);
        QCOMPARE(body.value(QLatin1String("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QLatin1String("billable")), QJsonValue(true));
        QCOMPARE(body.value(QLatin1String("created_with")).toString(), QStringLiteral("tokkl-test"));
        QCOMPARE(body.value(QLatin1String("description")).toString(), QString());
        // The session lengths are the account's preferences unless set.
        QVERIFY(!body.contains(QLatin1String("work_minutes")));

        const QJsonObject plain = QJsonDocument::fromJson(encodePomodoroStart(PomodoroStart(), 7, QStringLiteral("tokkl-test"))).object();
        QVERIFY(plain.value(QLatin1String("project_id")).isNull());
        QVERIFY(!plain.contains(QLatin1String("billable")));
    }
};

QTEST_GUILESS_MAIN(ApiTest)

#include "apitest.moc"
