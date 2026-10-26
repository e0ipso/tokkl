// The Pomodoro preferences client, driven through the scripted transport and
// credential store, with its cache in a QSettings file.

#include "connection.h"
#include "fakes.h"
#include "pomodoropreferences.h"
#include "pomodororecord.h"
#include "pomodorostore.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
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
}

class PomodoroPreferencesTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        SettingsPomodoroStore store{&settings};
        FakeTransport transport;
        FakeCredentialStore credentials;
        Connection connection{&transport, &credentials, testClientName()};
        PomodoroPreferences preferences{&connection, &store};

        PomodoroConfig cached(const QString &owner)
        {
            return PomodoroRecord::fromJson(store.loadRecord(owner)).config.value_or(PomodoroConfig{0, 0, 0, 0});
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
        const QString owner = f.connection.owner();
        QVERIFY(f.preferences.isEditable());
        QVERIFY(f.lastIs("GET", QStringLiteral("/api/v9/me/preferences")));
        f.transport.respondLast(FakeTransport::answer(
            200,
            QJsonDocument(QJsonObject{{workKey, 50}, {shortRestKey, QStringLiteral("10")}, {longRestKey, 61}}).toJson(QJsonDocument::Compact)));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 5, 15, 4}));
        QCOMPARE(refreshed.size(), 1);
        QVERIFY(refreshed.last().at(0).toBool());
        QCOMPARE(f.cached(owner), (PomodoroConfig{50, 5, 15, 4}));

        // A save posts only what changed, and shows and caches what the
        // server then holds.
        QVERIFY(f.preferences.save(50, 10, 15, 4));
        QVERIFY(f.preferences.isSaving());
        QVERIFY(f.lastIs("POST", QStringLiteral("/api/v9/me/preferences")));
        QCOMPARE(f.lastBody(), (QJsonObject{{shortRestKey, 10}}));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({50, 10, 15, 4})));
        QVERIFY(!f.preferences.isSaving());
        QCOMPARE(f.preferences.config(), (PomodoroConfig{50, 10, 15, 4}));
        QCOMPARE(f.cached(owner), (PomodoroConfig{50, 10, 15, 4}));

        // Nothing changed, nothing sent.
        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.preferences.save(50, 10, 15, 4));
        QCOMPARE(f.transport.requests.size(), requests);

        // A 400 that names a key is that field's error.
        QVERIFY(f.preferences.save(200, 10, 15, 6));
        QCOMPARE(f.lastBody(), (QJsonObject{{workKey, 200}, {everyKey, 6}}));
        f.transport.respondLast(FakeTransport::answer(400, message("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180")));
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
        f.transport.respondLast(FakeTransport::answer(400, message("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60")));
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
        QCOMPARE(f.cached(owner), (PomodoroConfig{50, 10, 20, 4}));
        QCOMPARE(refreshed.size(), 2);
    }

    void showsCachedLengthsWithoutAConnection()
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

        // A new client, as after a restart, shows the cached lengths and
        // reads nothing until the connection is back.
        const qsizetype requests = f.transport.requests.size();
        PomodoroPreferences restarted(&f.connection, &f.store);
        QCOMPARE(restarted.config(), (PomodoroConfig{40, 8, 20, 3}));
        QVERIFY(!restarted.isEditable());
        QCOMPARE(f.transport.requests.size(), requests);

        // A read that fails keeps them.
        QSignalSpy refreshed(&restarted, &PomodoroPreferences::refreshed);
        restarted.refresh();
        f.transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::NetworkError));
        QCOMPARE(refreshed.size(), 1);
        QVERIFY(!refreshed.last().at(0).toBool());
        QVERIFY(!restarted.errorString().isEmpty());
        QCOMPARE(restarted.config(), (PomodoroConfig{40, 8, 20, 3}));

        // Back online, both read again.
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.transport.requests.size(), requests + 4);
        f.transport.respond(requests + 2, FakeTransport::answer(200, preferencesBody({45, 8, 20, 3})));
        f.transport.respond(requests + 3, FakeTransport::answer(200, preferencesBody({45, 8, 20, 3})));
        QCOMPARE(restarted.config(), (PomodoroConfig{45, 8, 20, 3}));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{45, 8, 20, 3}));
        QVERIFY(restarted.isEditable());
        QVERIFY(restarted.errorString().isEmpty());
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
        f.transport.respond(read, FakeTransport::answer(404, message("Not found")));
        QCOMPARE(f.preferences.errorString(), QStringLiteral("Not found"));
        QCOMPARE(refreshed.size(), 2);

        QVERIFY(configure(f, instanceB));
        QVERIFY(f.preferences.errorString().isEmpty());
        QVERIFY(!f.preferences.isSaving());
        QVERIFY(!f.preferences.isEditable());
        QCOMPARE(f.preferences.config(), PomodoroConfig());

        // The save's late answer changes nothing, here or in the cache.
        f.transport.respond(post, FakeTransport::answer(200, preferencesBody({41, 8, 20, 3})));
        QCOMPARE(f.preferences.config(), PomodoroConfig());
        QCOMPARE(f.cached(ownerA), (PomodoroConfig{40, 8, 20, 3}));

        // The other account reads and caches its own lengths.
        f.transport.respondLast(FakeTransport::answer(200, meBody(3, 7)));
        const QString ownerB = f.connection.owner();
        QVERIFY(ownerB != ownerA);
        f.preferences.refresh();
        const qsizetype staleRead = f.transport.requests.size() - 1;
        f.transport.respond(staleRead - 1, FakeTransport::answer(200, preferencesBody({30, 6, 18, 2})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{30, 6, 18, 2}));
        QCOMPARE(f.cached(ownerB), (PomodoroConfig{30, 6, 18, 2}));

        // Back on the first account, its cached lengths show before the read
        // answers, and the other account's read in flight is dropped.
        const qsizetype signals = refreshed.size();
        QVERIFY(connectAccount(f, instanceA, 3, 7));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{40, 8, 20, 3}));
        f.transport.respond(staleRead, FakeTransport::answer(200, preferencesBody({31, 6, 18, 2})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{40, 8, 20, 3}));
        QCOMPARE(f.cached(ownerB), (PomodoroConfig{30, 6, 18, 2}));
        QCOMPARE(refreshed.size(), signals);

        // The same credentials now name another account. The state stays
        // Connected, and that account's lengths are read.
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({40, 8, 20, 3})));
        f.connection.refreshAccount();
        f.transport.respondLast(FakeTransport::answer(200, meBody(4, 7)));
        QCOMPARE(f.connection.state(), Connection::Connected);
        QCOMPARE(f.preferences.config(), PomodoroConfig());
        QVERIFY(f.lastIs("GET", QStringLiteral("/api/v9/me/preferences")));
        f.transport.respondLast(FakeTransport::answer(200, preferencesBody({35, 7, 25, 5})));
        QCOMPARE(f.preferences.config(), (PomodoroConfig{35, 7, 25, 5}));
        QCOMPARE(f.cached(f.connection.owner()), (PomodoroConfig{35, 7, 25, 5}));
        QCOMPARE(f.cached(ownerA), (PomodoroConfig{40, 8, 20, 3}));
    }
};

QTEST_GUILESS_MAIN(PomodoroPreferencesTest)
#include "pomodoropreferencestest.moc"
