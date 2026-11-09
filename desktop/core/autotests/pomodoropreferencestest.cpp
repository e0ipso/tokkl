// The Pomodoro preferences client, driven through the scripted transport and
// credential store.

#include "connection.h"
#include "fakes.h"
#include "pomodoropreferences.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-pomodoro-1");
const QString workKey = QStringLiteral("pomodoro_focus_interval_in_minutes");
const QString shortRestKey = QStringLiteral("pomodoro_break_interval_in_minutes");
const QString longRestKey = QStringLiteral("pomodoro_long_break_interval_in_minutes");
const QString everyKey = QStringLiteral("pomodoro_long_break_every");

// The account. What its server announces comes from GET /api/app/status.
QByteArray meBody(qint64 id, qint64 workspace)
{
    const QJsonObject me{
        {QStringLiteral("id"), id},
        {QStringLiteral("email"), QStringLiteral("bea@example.test")},
        {QStringLiteral("fullname"), QStringLiteral("Bea")},
        {QStringLiteral("timezone"), QStringLiteral("UTC")},
        {QStringLiteral("default_workspace_id"), workspace},
    };
    return QJsonDocument(me).toJson(QJsonDocument::Compact);
}

// The whole preferences object the server answers with, including a key of
// another client.
QByteArray preferencesBody(const PomodoroConfig &config)
{
    return QJsonDocument(QJsonObject{
                             {workKey, config.workMinutes},
                             {shortRestKey, config.shortRestMinutes},
                             {longRestKey, config.longRestMinutes},
                             {everyKey, config.longRestEvery},
                             {QStringLiteral("theme"), QStringLiteral("dark")},
                         })
        .toJson(QJsonDocument::Compact);
}

// An error body: the API sends the message as a bare JSON string.
QByteArray message(const char *text)
{
    return QByteArrayLiteral("\"") + QByteArray(text) + QByteArrayLiteral("\"");
}

// A 400 for the preference key, which the Tokkl-Error-Field header names.
HttpResponse refusal(const QString &key, const char *text)
{
    HttpResponse response = FakeTransport::answer(400, message(text));
    response.errorField = key.toLatin1();
    return response;
}
}

class PomodoroPreferencesTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore credentials;
        FakeClock clock;
        Connection connection{&transport, &credentials, clock, testClientName()};
        PomodoroPreferences preferences{&connection};

        Fixture()
        {
            transport.status = FakeTransport::currentStatus();
        }

        bool lastIs(const QByteArray &method, const QString &path) const
        {
            const HttpRequest &request = transport.requests.last();
            return request.method == method && request.url.path() == path;
        }

        QJsonObject lastBody() const
        {
            return QJsonDocument::fromJson(transport.requests.last().body).object();
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

    // Configure the instance and answer /me. Leaves the preferences read the
    // connection triggers unanswered.
    static bool connectAccount(Fixture &f, const QString &url, qint64 userId, qint64 workspace)
    {
        if (!configure(f, url)) {
            return false;
        }
        f.transport.respondLast(FakeTransport::answer(200, meBody(userId, workspace)));
        return f.connection.state() == Connection::Connected;
    }

private Q_SLOTS:
    // The settings pages read the ranges and defaults from here: the
    // placeholder until a server announces its pomodoro_limits, then the
    // server's, which also give the defaults shown and the reading of a
    // value out of range. They stay while the connection is gone.
    void limitsFollowTheServer()
    {
        Fixture f;
        QSignalSpy limitsChanged(&f.preferences, &PomodoroPreferences::limitsChanged);
        QCOMPARE(f.preferences.pomodoroLimits(), PomodoroLimits::placeholder());
        QCOMPARE(f.preferences.limits().value(QStringLiteral("workMinutes")).toMap().value(QStringLiteral("max")).toInt(), 999);
        QCOMPARE(f.preferences.config(), PomodoroConfig());

        QJsonObject status = currentServerApi();
        QJsonObject limits = status.value(QStringLiteral("pomodoro_limits")).toObject();
        limits.insert(QStringLiteral("work_minutes"), QJsonObject{{QStringLiteral("min"), 5}, {QStringLiteral("max"), 240}, {QStringLiteral("default"), 30}});
        status.insert(QStringLiteral("pomodoro_limits"), limits);
        f.transport.status = FakeTransport::answer(200, QJsonDocument(status).toJson(QJsonDocument::Compact));
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        QCOMPARE(limitsChanged.size(), 1);
        const QVariantMap work = f.preferences.limits().value(QStringLiteral("workMinutes")).toMap();
        QCOMPARE(work.value(QStringLiteral("min")).toInt(), 5);
        QCOMPARE(work.value(QStringLiteral("max")).toInt(), 240);
        QCOMPARE(work.value(QStringLiteral("default")).toInt(), 30);
        QCOMPARE(f.preferences.limits().value(QStringLiteral("shortRestMinutes")).toMap().value(QStringLiteral("max")).toInt(), 60);
        // The account's defaults are the server's until its lengths are read.
        QCOMPARE(f.preferences.workMinutes(), 30);
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({200, 5, 15, 4})));
        QCOMPARE(f.preferences.workMinutes(), 200);

        // Signed out: the last limits stay.
        f.connection.setInstanceUrl(QString());
        QTRY_COMPARE(f.connection.state(), Connection::Unconfigured);
        QCOMPARE(f.preferences.limits().value(QStringLiteral("workMinutes")).toMap().value(QStringLiteral("max")).toInt(), 240);
        QCOMPARE(limitsChanged.size(), 1);
    }

    void readsAndSavesOnlyChangedKeys()
    {
        Fixture f;
        QSignalSpy refreshed(&f.preferences, &PomodoroPreferences::refreshed);
        QVERIFY(!f.preferences.isEditable());
        QCOMPARE(f.preferences.config(), PomodoroConfig());

        // Connecting reads the preferences. Each Pomodoro key falls back to
        // its default on its own: a string, a value out of range and a
        // missing key.
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        QVERIFY(f.preferences.isEditable());
        QVERIFY(f.lastIs("GET", QStringLiteral("/api/app/me/preferences")));
        f.transport.respondLast(FakeTransport::answer(
            200,
            QJsonDocument(QJsonObject{{workKey, 50}, {shortRestKey, QStringLiteral("10")}, {longRestKey, 61}}).toJson(QJsonDocument::Compact)));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 5, 15, 4}));
        QCOMPARE(refreshed.size(), 1);
        QVERIFY(refreshed.last().at(0).toBool());

        // A save posts only what changed, and shows what the server then
        // holds.
        QVERIFY(f.preferences.save(50, 10, 15, 4));
        QVERIFY(f.preferences.isSaving());
        QVERIFY(f.lastIs("POST", QStringLiteral("/api/app/me/preferences")));
        QCOMPARE(f.lastBody(), (QJsonObject{{shortRestKey, 10}}));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({50, 10, 15, 4})));
        QVERIFY(!f.preferences.isSaving());
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 10, 15, 4}));

        // Nothing changed, nothing sent.
        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.preferences.save(50, 10, 15, 4));
        QCOMPARE(f.transport.requests.size(), requests);

        // A 400 that names a key is that field's error.
        QVERIFY(f.preferences.save(200, 10, 15, 6));
        QCOMPARE(f.lastBody(), (QJsonObject{{workKey, 200}, {everyKey, 6}}));
        f.transport.respondLast(refusal(workKey, "Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180"));
        QCOMPARE(f.preferences.workMinutesError(), QStringLiteral("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180"));
        QVERIFY(f.preferences.shortRestMinutesError().isEmpty());
        QVERIFY(f.preferences.longRestMinutesError().isEmpty());
        QVERIFY(f.preferences.longRestEveryError().isEmpty());
        QVERIFY(f.preferences.errorString().isEmpty());
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 10, 15, 4}));

        // The long rest key is not mistaken for the short rest one, and the
        // next save clears the earlier error.
        QVERIFY(f.preferences.save(50, 10, 61, 4));
        QVERIFY(f.preferences.workMinutesError().isEmpty());
        f.transport.respondLast(refusal(longRestKey, "Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60"));
        QCOMPARE(f.preferences.longRestMinutesError(), QStringLiteral("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60"));
        QVERIFY(f.preferences.shortRestMinutesError().isEmpty());

        // Any other failure is the general error.
        QVERIFY(f.preferences.save(50, 10, 20, 4));
        f.transport.respondLast(FakeTransport::answer(400, message("Preferences are too large")));
        QCOMPARE(f.preferences.errorString(), QStringLiteral("Preferences are too large"));
        QVERIFY(f.preferences.longRestMinutesError().isEmpty());

        // A read issued before a save does not replace what the save
        // returned.
        f.preferences.refresh();
        const qsizetype read = f.transport.requests.size() - 1;
        QVERIFY(f.preferences.save(50, 10, 20, 4));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({50, 10, 20, 4})));
        f.transport.respond(read, FakeTransport::answer(200, preferencesBody({50, 10, 15, 4})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 10, 20, 4}));
        QCOMPARE(refreshed.size(), 2);
    }

    // A server that names the refused key in Tokkl-Error-Field is believed
    // over the message; a key that is none of the four is the general
    // error, whatever the message says.
    void errorFieldHeaderNamesTheField()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({25, 5, 15, 4})));

        QVERIFY(f.preferences.save(25, 5, 61, 13));
        QVERIFY(f.lastIs("POST", QStringLiteral("/api/app/me/preferences")));
        HttpResponse refused = FakeTransport::answer(400, message("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180"));
        refused.errorCode = "invalid_preference";
        refused.errorField = "pomodoro_long_break_interval_in_minutes";
        f.transport.respondLast(refused);
        QCOMPARE(f.preferences.longRestMinutesError(), QStringLiteral("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180"));
        QVERIFY(f.preferences.workMinutesError().isEmpty());
        QVERIFY(f.preferences.errorString().isEmpty());

        QVERIFY(f.preferences.save(25, 5, 15, 13));
        HttpResponse other = FakeTransport::answer(400, message("Invalid pomodoro_long_break_every: expected an integer from 1 to 12"));
        other.errorField = "timezone";
        f.transport.respondLast(other);
        QVERIFY(f.preferences.longRestEveryError().isEmpty());
        QVERIFY(f.preferences.longRestMinutesError().isEmpty());
        QCOMPARE(f.preferences.errorString(), QStringLiteral("Invalid pomodoro_long_break_every: expected an integer from 1 to 12"));
    }

    // A refusal whose Tokkl-Error-Field header names no key is the general
    // error, also when its message names one.
    void aRefusalWithoutTheHeaderIsGeneral()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({25, 5, 15, 4})));
        QVERIFY(f.preferences.save(25, 5, 61, 4));
        f.transport.respondLast(FakeTransport::answer(400, message("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60")));
        QVERIFY(f.preferences.longRestMinutesError().isEmpty());
        QCOMPARE(f.preferences.errorString(), QStringLiteral("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60"));
    }

    // A server below the floor binds no account, so nothing is read and
    // nothing can be saved.
    void olderServerReadsNothing()
    {
        Fixture f;
        f.transport.status = FakeTransport::olderStatus();
        QVERIFY(configure(f, instanceA));
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Error);
        QCOMPARE(f.transport.requests.size(), 1);
        QVERIFY(!f.preferences.isEditable());
        QVERIFY(!f.preferences.save(30, 5, 15, 4));
        QCOMPARE(f.transport.requests.size(), 1);
    }

    // On a current server a 404 from the app path is a refusal like any
    // other: nothing goes to v9, and the next request asks the app path.
    void notFoundOnTheAppPathIsARefusal()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({25, 5, 15, 4})));
        const qsizetype before = f.transport.requests.size();
        QVERIFY(f.preferences.save(26, 5, 15, 4));
        QVERIFY(f.lastIs("POST", QStringLiteral("/api/app/me/preferences")));
        f.transport.respondLast(FakeTransport::answer(404, message("Not found")));
        QCOMPARE(f.transport.requests.size(), before + 1);
        QVERIFY(!f.preferences.isSaving());
        QCOMPARE(f.preferences.config(), (PomodoroConfig{25, 5, 15, 4}));

        f.preferences.refresh();
        QCOMPARE(f.transport.requests.size(), before + 2);
        QVERIFY(f.lastIs("GET", QStringLiteral("/api/app/me/preferences")));
    }

    void keepsTheLengthsReadWhileUnreachable()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({40, 8, 20, 3})));

        // The instance stops answering; the account stays bound, but stale.
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QCOMPARE(f.connection.state(), Connection::Disconnected);
        QVERIFY(!f.preferences.isEditable());
        QVERIFY(!f.preferences.save(41, 8, 20, 3));

        // A read that fails keeps the lengths.
        QSignalSpy refreshed(&f.preferences, &PomodoroPreferences::refreshed);
        f.preferences.refresh();
        f.transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QCOMPARE(refreshed.size(), 1);
        QVERIFY(!refreshed.last().at(0).toBool());
        QVERIFY(!f.preferences.errorString().isEmpty());
        QCOMPARE(f.preferences.config(), (PomodoroConfig{40, 8, 20, 3}));

        // A new client, as after a restart, shows the defaults and reads
        // nothing until the connection is back.
        const qsizetype requests = f.transport.requests.size();
        PomodoroPreferences restarted(&f.connection);
        QCOMPARE(restarted.config(), PomodoroConfig());
        QVERIFY(!restarted.isEditable());
        QCOMPARE(f.transport.requests.size(), requests);

        // Back online, both read again.
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.size(), requests + 3);
        f.transport.respond(requests + 1, FakeTransport::answer(200, preferencesBody({45, 8, 20, 3})));
        f.transport.respond(requests + 2, FakeTransport::answer(200, preferencesBody({45, 8, 20, 3})));
        QCOMPARE(restarted.config(), (PomodoroConfig{45, 8, 20, 3}));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{45, 8, 20, 3}));
        QVERIFY(restarted.isEditable());
        QVERIFY(f.preferences.errorString().isEmpty());
    }

    void earlierGenerationChangesNothing()
    {
        Fixture f;
        QSignalSpy refreshed(&f.preferences, &PomodoroPreferences::refreshed);
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        const QString ownerA = f.connection.owner();
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({40, 8, 20, 3})));

        // A read fails while a save runs; then the instance changes.
        f.preferences.refresh();
        const qsizetype read = f.transport.requests.size() - 1;
        QVERIFY(f.preferences.save(41, 8, 20, 3));
        const qsizetype post = f.transport.requests.size() - 1;
        f.transport.respond(read, FakeTransport::answer(400, message("Preferences are unavailable")));
        QCOMPARE(f.preferences.errorString(), QStringLiteral("Preferences are unavailable"));
        QCOMPARE(refreshed.size(), 2);

        QVERIFY(configure(f, instanceB));
        QVERIFY(f.preferences.errorString().isEmpty());
        QVERIFY(!f.preferences.isSaving());
        QVERIFY(!f.preferences.isEditable());
        QCOMPARE(f.preferences.config(), PomodoroConfig());

        // The save's late answer changes nothing.
        f.transport.respond(post, FakeTransport::answer(200, preferencesBody({41, 8, 20, 3})));
        QCOMPARE(f.preferences.config(), PomodoroConfig());

        // The other account reads its own lengths.
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        const QString ownerB = f.connection.owner();
        QVERIFY(ownerB != ownerA);
        f.preferences.refresh();
        const qsizetype staleRead = f.transport.requests.size() - 1;
        f.transport.respond(staleRead - 1, FakeTransport::answer(200, preferencesBody({30, 6, 18, 2})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{30, 6, 18, 2}));

        // Back on the first account, the defaults show until its read
        // answers, and the other account's read in flight is dropped.
        const qsizetype signals = refreshed.size();
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        QCOMPARE(f.preferences.config(), PomodoroConfig());
        f.transport.respond(staleRead, FakeTransport::answer(200, preferencesBody({31, 6, 18, 2})));
        QCOMPARE(f.preferences.config(), PomodoroConfig());
        QCOMPARE(refreshed.size(), signals);

        // The same credentials now name another account. The state stays
        // Connected, and that account's lengths are read.
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({40, 8, 20, 3})));
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meBody(4, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.preferences.config(), PomodoroConfig());
        QVERIFY(f.lastIs("GET", QStringLiteral("/api/app/me/preferences")));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({35, 7, 25, 5})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{35, 7, 25, 5}));
    }
};

QTEST_GUILESS_MAIN(PomodoroPreferencesTest)
#include "pomodoropreferencestest.moc"
