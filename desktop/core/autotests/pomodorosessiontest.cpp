// The Pomodoro session next to the timer controller, driven through the fake
// clock and the scripted transport, with the real preferences client, save
// queue and store, so every save goes through the store to the transport.

#include "connection.h"
#include "fakes.h"
#include "pomodoropreferences.h"
#include "pomodoroqueue.h"
#include "pomodororecord.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "timercontroller.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

#include <memory>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-session-1");
const QByteArray currentPath = "/me/time_entries/current";
const QByteArray entriesPath = "/workspaces/7/time_entries";
const QByteArray preferencesPath = "/me/preferences";
// Lengths of one minute and a long rest after every second work phase.
const PomodoroConfig lengths{1, 1, 1, 2};
const QString tooShort = QStringLiteral("This pomodoro was too short to save.");

QByteArray meBody(qint64 id, qint64 workspace, const QString &timezone = QStringLiteral("UTC"))
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), timezone},
                             {QStringLiteral("default_workspace_id"), workspace},
                             {QStringLiteral("beginning_of_week"), 1},
                             {QStringLiteral("time_resolution_minutes"), 1},
                         })
        .toJson(QJsonDocument::Compact);
}

QByteArray preferencesBody(const PomodoroConfig &config)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("pomodoro_focus_interval_in_minutes"), config.workMinutes},
                             {QStringLiteral("pomodoro_break_interval_in_minutes"), config.shortRestMinutes},
                             {QStringLiteral("pomodoro_long_break_interval_in_minutes"), config.longRestMinutes},
                             {QStringLiteral("pomodoro_long_break_every"), config.longRestEvery},
                         })
        .toJson(QJsonDocument::Compact);
}

QString iso(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODate);
}

// A running entry of the workspace, as the server answers it.
QByteArray runningEntry(qint64 id, const QDateTime &start, std::optional<qint64> project = std::nullopt)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("billable"), false},
                             {QStringLiteral("start"), start.toUTC().toString(Qt::ISODate)},
                             {QStringLiteral("stop"), QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("duration"), -start.toSecsSinceEpoch()},
                             {QStringLiteral("description"), QString()},
                             {QStringLiteral("tags"), QJsonArray()},
                         })
        .toJson(QJsonDocument::Compact);
}

// The entry a stop answers with: stopped, with the duration stored.
QByteArray stoppedEntryBody(qint64 id, const QDateTime &start, qint64 duration)
{
    QJsonObject entry = QJsonDocument::fromJson(runningEntry(id, start)).object();
    entry.insert(QStringLiteral("stop"), iso(start.addSecs(duration)));
    entry.insert(QStringLiteral("duration"), duration);
    return QJsonDocument(entry).toJson(QJsonDocument::Compact);
}

// The stopped entry the server answers a POST with.
QByteArray stoppedEntry(qint64 id, const QJsonObject &posted)
{
    QJsonObject entry = posted;
    entry.insert(QStringLiteral("id"), id);
    return QJsonDocument(entry).toJson(QJsonDocument::Compact);
}

// One active, billable project of the workspace.
QByteArray projectsBody()
{
    return QByteArrayLiteral(R"([{"id":11,"workspace_id":7,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])");
}
}

class PomodoroSessionTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        FakeTransport transport;
        FakeCredentialStore credentials;
        FakeClock clock;
        FakeChainStore chains;
        SettingsPomodoroStore store{&settings};
        Connection connection{&transport, &credentials, testClientName()};
        TimerController timer{&clock};
        PomodoroPreferences preferences{&connection, &store};
        PomodoroQueue queue{&connection, &clock, &store};
        // Absent for a test that creates it later, after a restart.
        std::unique_ptr<PomodoroSession> session;
        QSet<qsizetype> answered;

        explicit Fixture(bool withSession = true)
        {
            timer.setChainStore(&chains);
            timer.setConnection(&connection);
            if (withSession) {
                createSession();
            }
        }

        void createSession()
        {
            session = std::make_unique<PomodoroSession>(&clock, &timer, &preferences, &queue, &store);
        }

        // Requests whose API path (after /api/v9) ends with the given text.
        QList<qsizetype> find(const QByteArray &method, const QByteArray &suffix) const
        {
            QList<qsizetype> found;
            for (qsizetype i = 0; i < transport.requests.size(); ++i) {
                const HttpRequest &request = transport.requests.at(i);
                if (request.method == method && request.url.path().toUtf8().endsWith(suffix)) {
                    found.append(i);
                }
            }
            return found;
        }

        qsizetype last(const QByteArray &method, const QByteArray &suffix) const
        {
            const QList<qsizetype> found = find(method, suffix);
            return found.isEmpty() ? -1 : found.last();
        }

        bool unanswered(qsizetype index) const
        {
            return index >= 0 && !answered.contains(index);
        }

        void respond(qsizetype index, const HttpResponse &response)
        {
            answered.insert(index);
            transport.respond(index, response);
        }

        qsizetype posts() const
        {
            return find("POST", entriesPath).size();
        }

        QJsonObject body(qsizetype index) const
        {
            return QJsonDocument::fromJson(transport.requests.at(index).body).object();
        }

        PomodoroRecord stored() const
        {
            return PomodoroRecord::fromJson(const_cast<SettingsPomodoroStore &>(store).loadRecord(connection.owner()));
        }
    };

    // Configure token auth, answer /me with a one-minute grid, then the
    // reads the timer and the preferences send: nothing runs, one project,
    // and the lengths every session of these tests uses.
    static bool connectAccount(Fixture &f, const QString &url = instanceA, const QString &timezone = QStringLiteral("UTC"), const QByteArray &current = "null")
    {
        f.credentials.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(url);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.respond(before, FakeTransport::answer(200, meBody(3, 7, timezone)));
        const qsizetype entry = f.last("GET", currentPath);
        const qsizetype projects = f.last("GET", "/projects");
        const qsizetype preferences = f.last("GET", preferencesPath);
        if (!f.unanswered(entry) || !f.unanswered(projects) || !f.unanswered(preferences)) {
            return false;
        }
        f.respond(entry, FakeTransport::answer(200, current));
        f.respond(projects, FakeTransport::answer(200, projectsBody()));
        f.respond(preferences, FakeTransport::answer(200, preferencesBody(lengths)));
        return f.timer.isConnected() && f.preferences.config() == lengths;
    }

    // Start session, then answer the read it issues with the given lengths.
    static bool start(Fixture &f, const HttpResponse &read = FakeTransport::answer(200, preferencesBody(lengths)))
    {
        if (!f.session->startSession()) {
            return false;
        }
        const qsizetype request = f.last("GET", preferencesPath);
        if (!f.unanswered(request) || f.session->isActive()) {
            return false;
        }
        f.respond(request, read);
        return f.session->isActive();
    }

    static void tick(Fixture &f, int seconds)
    {
        for (int i = 0; i < seconds; ++i) {
            f.clock.advance(1000);
        }
    }

private Q_SLOTS:
    void runsAFullCycle()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(!f.session->pomodoroMode());
        QVERIFY(!f.session->canStartSession());
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(f.session->canStartSession());
        QVERIFY(!f.session->modeLocked());
        QVERIFY(f.store.loadPomodoroMode());

        // Start records the click instant and waits for the lengths. A
        // second Start meanwhile does nothing.
        const QDateTime at = f.clock.now();
        QVERIFY(f.session->startSession());
        QVERIFY(!f.session->startSession());
        QVERIFY(!f.session->canStartSession());
        const qsizetype read = f.last("GET", preferencesPath);
        QVERIFY(f.unanswered(read));
        QVERIFY(!f.session->isActive());
        tick(f, 2);
        f.respond(read, FakeTransport::answer(200, preferencesBody(lengths)));
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->modeLocked());
        QVERIFY(!f.session->canStartSession());
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.session->phaseStart(), at);
        QCOMPARE(f.session->plannedEnd(), at.addSecs(60));
        QCOMPARE(f.session->remainingSeconds(), 58);
        QCOMPARE(f.session->overtimeSeconds(), 0);
        QCOMPARE(f.session->countdownText(), QStringLiteral("0:58"));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        QCOMPARE(f.session->longRestEvery(), 2);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("shortRest"));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QString());
        QVERIFY(f.stored().session.has_value());
        QCOMPARE(f.stored().session->pomodoroStart, at);
        QCOMPARE(f.stored().session->config, lengths);

        // The planned end rings, and keeps ringing, until Next phase.
        QSignalSpy ringing(f.session.get(), &PomodoroSession::ringingChanged);
        tick(f, 57);
        QCOMPARE(f.session->countdownText(), QStringLiteral("0:01"));
        QCOMPARE(ringing.size(), 0);
        tick(f, 1);
        QVERIFY(f.session->isRinging());
        QCOMPARE(ringing.size(), 1);
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("workToShortRest"));
        QCOMPARE(f.session->countdownText(), QStringLiteral("+0:00"));
        QCOMPARE(f.session->remainingSeconds(), 0);
        tick(f, 1);
        QCOMPARE(f.session->overtimeSeconds(), 1);
        QCOMPARE(f.session->countdownText(), QStringLiteral("+0:01"));
        QCOMPARE(ringing.size(), 1);

        // Work to rest saves nothing.
        QCOMPARE(f.posts(), 0);
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.posts(), 0);
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        QCOMPARE(f.session->phaseStart(), at.addSecs(61));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("work"));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QString());
        QCOMPARE(ringing.size(), 2);
        QCOMPARE(f.session->countdownText(), QStringLiteral("1:00"));
        QCOMPARE(f.stored().session->pomodoroStart, at);
        QCOMPARE(f.stored().session->revision, 1);

        tick(f, 60);
        QVERIFY(f.session->isRinging());
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("shortRestToWork"));
        tick(f, 1);

        // Rest to work saves the pomodoro from its work start to now,
        // snapped to the minute, and the next one starts at the exact
        // instant. The item is written with the new phase, before the POST.
        const QDateTime confirmed = f.clock.now();
        QCOMPARE(confirmed, at.addSecs(122));
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.posts(), 1);
        const qsizetype post = f.last("POST", entriesPath);
        const QJsonObject body = f.body(post);
        QCOMPARE(body.value(QLatin1String("start")).toString(), QStringLiteral("2026-10-16T09:00:00Z"));
        QCOMPARE(body.value(QLatin1String("stop")).toString(), QStringLiteral("2026-10-16T09:02:00Z"));
        QCOMPARE(body.value(QLatin1String("duration")).toInteger(), 120);
        QVERIFY(body.value(QLatin1String("project_id")).isNull());
        QCOMPARE(body.value(QLatin1String("billable")).toBool(), false);
        QCOMPARE(body.value(QLatin1String("workspace_id")).toInteger(), 7);
        QCOMPARE(body.value(QLatin1String("created_with")).toString(), testClientName());
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.session->phaseStart(), confirmed);
        QCOMPARE(f.session->pomodoroNumber(), 2);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("longRest"));
        QCOMPARE(f.stored().session->revision, 2);
        QCOMPARE(f.stored().session->pomodoroStart, confirmed);
        QCOMPARE(f.stored().unsaved.size(), 1);
        QCOMPARE(f.stored().unsaved.first().attempts, 1);
        f.respond(post, FakeTransport::answer(200, stoppedEntry(100, body)));
        QVERIFY(f.stored().unsaved.isEmpty());
        QVERIFY(f.stored().session.has_value());
        QVERIFY(f.session->message().isEmpty());
    }

    void startsWithTheLengthsReadOrTheLastKnown()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));

        // The read answers with a longer work phase: the session uses it.
        QVERIFY(start(f, FakeTransport::answer(200, preferencesBody({2, 1, 1, 2}))));
        QCOMPARE(f.session->plannedEnd(), f.clock.now().addSecs(120));
        QCOMPARE(f.session->countdownText(), QStringLiteral("2:00"));
        QVERIFY(f.session->endSession());
        QCOMPARE(f.session->message(), tooShort);

        // A read that fails starts with the lengths last read.
        tick(f, 5);
        QVERIFY(start(f, FakeTransport::failure(HttpResponse::Outcome::NetworkError)));
        QCOMPARE(f.session->plannedEnd(), f.clock.now().addSecs(120));
        QCOMPARE(f.stored().session->config, (PomodoroConfig{2, 1, 1, 2}));
    }

    void skipsCountTowardTheLongRest()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        const QDateTime at = f.clock.now();
        QVERIFY(start(f));

        // Work skipped after 30 s still counts as the first work phase.
        tick(f, 30);
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        tick(f, 30);
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.posts(), 1);
        QCOMPARE(f.body(f.last("POST", entriesPath)).value(QLatin1String("stop")).toString(), iso(at.addSecs(60)));
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.session->pomodoroNumber(), 2);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("longRest"));
        tick(f, 60);
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("workToLongRest"));
    }

    void longRestResetsTheCount()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(start(f));
        tick(f, 60);
        QVERIFY(f.session->confirmNextPhase());
        tick(f, 60);
        QVERIFY(f.session->confirmNextPhase());
        f.respond(f.last("POST", entriesPath), FakeTransport::answer(200, stoppedEntry(100, f.body(f.last("POST", entriesPath)))));
        QCOMPARE(f.session->pomodoroNumber(), 2);
        tick(f, 60);
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.session->phase(), QStringLiteral("longRest"));
        QCOMPARE(f.session->pomodoroNumber(), 2);
        QCOMPARE(f.session->plannedEnd(), f.clock.now().addSecs(60));
        tick(f, 60);
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("longRestToWork"));
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.posts(), 2);
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.session->pomodoroNumber(), 1);
        QCOMPARE(f.session->nextPhase(), QStringLiteral("shortRest"));
    }

    void endsTheSessionInARest()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        const QDateTime at = f.clock.now();
        QVERIFY(start(f));
        tick(f, 60);
        QVERIFY(f.session->confirmNextPhase());
        tick(f, 10);

        // The pomodoro runs from its work start to now, snapped.
        QVERIFY(f.session->endSession());
        QVERIFY(!f.session->isActive());
        QVERIFY(!f.session->modeLocked());
        QVERIFY(f.session->pomodoroMode());
        QVERIFY(f.session->canStartSession());
        QCOMPARE(f.session->phase(), QString());
        QCOMPARE(f.session->countdownText(), QString());
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.posts(), 1);
        const QJsonObject body = f.body(f.last("POST", entriesPath));
        QCOMPARE(body.value(QLatin1String("start")).toString(), iso(at));
        QCOMPARE(body.value(QLatin1String("stop")).toString(), iso(at.addSecs(60)));
        QVERIFY(!f.stored().session.has_value());
        QCOMPARE(f.stored().unsaved.size(), 1);
        QVERIFY(!f.session->endSession());
    }

    void reportsAPomodoroTooShortToSave()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        QSignalSpy messages(f.session.get(), &PomodoroSession::messageChanged);
        QVERIFY(start(f));
        tick(f, 10);
        QVERIFY(f.session->endSession());
        QCOMPARE(f.posts(), 0);
        QVERIFY(!f.session->isActive());
        QCOMPARE(f.session->message(), tooShort);
        QCOMPARE(messages.size(), 1);
        QVERIFY(f.stored().unsaved.isEmpty());
        f.session->clearMessage();
        QVERIFY(f.session->message().isEmpty());
        QCOMPARE(messages.size(), 2);

        // The server's refusal of a saved pomodoro shows the same way.
        QVERIFY(start(f));
        tick(f, 100);
        QVERIFY(f.session->endSession());
        f.respond(f.last("POST", entriesPath), FakeTransport::answer(422, QByteArrayLiteral("\"Entry overlaps another\"")));
        QCOMPARE(f.session->message(), QStringLiteral("Entry overlaps another"));
        QCOMPARE(messages.size(), 3);
    }

    void snapsInUtcWhenTheZoneIsUnknown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, QStringLiteral("Mars/Olympus")));
        QVERIFY(f.session->setPomodoroMode(true));
        const QDateTime at = f.clock.now();
        QVERIFY(start(f));
        tick(f, 100);
        QVERIFY(f.session->endSession());
        QCOMPARE(f.posts(), 1);
        const QJsonObject body = f.body(f.last("POST", entriesPath));
        QCOMPARE(body.value(QLatin1String("start")).toString(), iso(at));
        QCOMPARE(body.value(QLatin1String("stop")).toString(), iso(at.addSecs(120)));
        QVERIFY(f.session->message().isEmpty());
    }

    void locksTheModeWhileATimerOrASessionRuns()
    {
        Fixture f;
        const QDateTime at = f.clock.now();
        QVERIFY(connectAccount(f, instanceA, QStringLiteral("UTC"), runningEntry(5, at.addSecs(-65))));
        QSignalSpy locks(f.session.get(), &PomodoroSession::modeLockedChanged);

        // Running.
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.session->modeLocked());
        QVERIFY(!f.session->setPomodoroMode(true));
        QVERIFY(!f.session->pomodoroMode());
        QVERIFY(!f.store.loadPomodoroMode());

        // Paused.
        QVERIFY(f.timer.pause());
        const qsizetype stop = f.last("PATCH", "/stop");
        QVERIFY(f.unanswered(stop));
        f.respond(stop, FakeTransport::answer(200, stoppedEntryBody(5, at.addSecs(-65), 65)));
        const qsizetype read = f.last("GET", currentPath);
        if (f.unanswered(read)) {
            f.respond(read, FakeTransport::answer(200, "null"));
        }
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.session->modeLocked());
        QVERIFY(!f.session->setPomodoroMode(true));
        QCOMPARE(locks.size(), 0);

        // Stopped: the mode can change, and a session locks it again.
        QVERIFY(f.timer.stop());
        QVERIFY(!f.timer.isPaused());
        QVERIFY(!f.session->modeLocked());
        QCOMPARE(locks.size(), 1);
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(start(f));
        QVERIFY(f.session->modeLocked());
        QCOMPARE(locks.size(), 2);
        QVERIFY(!f.session->setPomodoroMode(false));
        QVERIFY(f.session->pomodoroMode());
        QVERIFY(f.session->endSession());
        QVERIFY(!f.session->modeLocked());
        QVERIFY(f.session->setPomodoroMode(false));
        QVERIFY(!f.store.loadPomodoroMode());
    }

    void routesTheClickByModeAndState()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const qsizetype requests = f.transport.requests.size();

        // Timer mode: the click starts the timer, then pauses it.
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype started = f.last("POST", entriesPath);
        QCOMPARE(started, requests);
        const QDateTime at = f.clock.now();
        f.respond(started, FakeTransport::answer(200, runningEntry(5, at)));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.session->setPomodoroMode(false));
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype stop = f.last("PATCH", "/stop");
        QVERIFY(f.unanswered(stop));
        f.respond(stop, FakeTransport::answer(200, stoppedEntryBody(5, at, 1)));
        const qsizetype read = f.last("GET", currentPath);
        if (f.unanswered(read)) {
            f.respond(read, FakeTransport::answer(200, "null"));
        }
        QVERIFY(f.timer.isPaused());
        QVERIFY(f.timer.stop());

        // Pomodoro mode without a session: the click starts one, and
        // another click while the lengths are read does nothing.
        QVERIFY(f.session->setPomodoroMode(true));
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        const qsizetype preferences = f.last("GET", preferencesPath);
        QVERIFY(f.unanswered(preferences));
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Ignored);
        f.respond(preferences, FakeTransport::answer(200, preferencesBody(lengths)));
        QVERIFY(f.session->isActive());

        // Before the planned end the platform opens the menu; nothing is
        // sent and nothing changes.
        const qsizetype before = f.transport.requests.size();
        tick(f, 10);
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::OpenMenu);
        QCOMPARE(f.session->phase(), QStringLiteral("work"));
        QCOMPARE(f.transport.requests.size(), before);

        // Ringing: the click is Next phase.
        tick(f, 50);
        QVERIFY(f.session->isRinging());
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        QCOMPARE(f.session->phase(), QStringLiteral("shortRest"));
        QVERIFY(!f.session->isRinging());
        QVERIFY(f.session->endSession());

        // A foreign timer in Pomodoro mode still gets the timer click.
        tick(f, 30);
        const qsizetype poll = f.last("GET", currentPath);
        QVERIFY(f.unanswered(poll));
        f.respond(poll, FakeTransport::answer(200, runningEntry(9, f.clock.now().addSecs(-5))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Handled);
        QVERIFY(f.unanswered(f.last("PATCH", "/stop")));
    }

    void ignoresTheClickWithoutAnAccount()
    {
        Fixture f(false);
        QVERIFY(f.store.savePomodoroMode(true));
        f.createSession();
        QVERIFY(f.session->pomodoroMode());
        QVERIFY(!f.session->canStartSession());
        QCOMPARE(f.session->activate(), PomodoroSession::Activation::Ignored);
        QVERIFY(!f.session->startSession());
        QCOMPARE(f.transport.requests.size(), 0);
    }

    void handsOverToAForeignTimer()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        const QDateTime at = f.clock.now();
        QVERIFY(start(f));

        // An entry started at the pomodoro start or before is not a
        // handoff.
        tick(f, 30);
        qsizetype poll = f.last("GET", currentPath);
        QVERIFY(f.unanswered(poll));
        f.respond(poll, FakeTransport::answer(200, runningEntry(8, at)));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->modeLocked());
        QCOMPARE(f.posts(), 0);

        // One started later ends the session at its start.
        tick(f, 30);
        poll = f.last("GET", currentPath);
        QVERIFY(f.unanswered(poll));
        f.respond(poll, FakeTransport::answer(200, runningEntry(9, at.addSecs(40))));
        QVERIFY(!f.session->isActive());
        QCOMPARE(f.posts(), 1);
        const QJsonObject body = f.body(f.last("POST", entriesPath));
        QCOMPARE(body.value(QLatin1String("start")).toString(), iso(at));
        QCOMPARE(body.value(QLatin1String("stop")).toString(), iso(at.addSecs(60)));
        QCOMPARE(body.value(QLatin1String("duration")).toInteger(), 60);
        QVERIFY(!f.stored().session.has_value());
        QVERIFY(f.session->modeLocked());
        QVERIFY(f.session->pomodoroMode());
    }

    void ringsAtOnceAfterARestart()
    {
        Fixture f(false);
        const QDateTime at = f.clock.now();
        const QString owner = QStringLiteral("https://a.example.test/ 3 7");
        PomodoroRecord record;
        record.config = lengths;
        PomodoroSessionRecord session;
        session.id = QStringLiteral("s1");
        session.config = lengths;
        session.phase = SessionPhase{PhaseKind::Work, at.addSecs(-300), 1};
        session.pomodoroStart = session.phase.startedAt;
        record.session = session;
        QVERIFY(f.store.savePomodoroMode(true));
        QVERIFY(f.store.saveRecord(owner, record.toJson()));

        // Nothing shows before the account is bound.
        f.createSession();
        QVERIFY(f.session->pomodoroMode());
        QVERIFY(!f.session->isActive());
        QSignalSpy ringing(f.session.get(), &PomodoroSession::ringingChanged);
        QVERIFY(connectAccount(f));
        QCOMPARE(f.connection.owner(), owner);
        QVERIFY(f.session->isActive());
        QVERIFY(f.session->isRinging());
        QCOMPARE(ringing.size(), 1);
        QCOMPARE(f.session->ringingTransition(), QStringLiteral("workToLongRest"));
        QCOMPARE(f.session->countdownText(), QStringLiteral("+4:00"));
        QCOMPARE(f.session->pomodoroNumber(), 2);
        QVERIFY(f.session->modeLocked());
        QVERIFY(f.session->confirmNextPhase());
        QCOMPARE(f.session->phase(), QStringLiteral("longRest"));
        QVERIFY(!f.session->isRinging());
        QCOMPARE(f.stored().session->revision, 1);
    }

    void appliesAProjectChangeToTheSavedEntry()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.session->setPomodoroMode(true));
        QVERIFY(start(f));
        QVERIFY(!f.stored().session->projectId.has_value());

        // The menu picks the project: the session and the store follow,
        // with the project's billable default.
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.stored().session->projectId, std::optional<qint64>(11));
        QCOMPARE(f.stored().session->billable, true);
        QVERIFY(f.timer.chooseBillable(false));
        QCOMPARE(f.stored().session->billable, false);
        QVERIFY(f.timer.chooseBillable(true));
        tick(f, 100);
        QVERIFY(f.session->endSession());
        const QJsonObject body = f.body(f.last("POST", entriesPath));
        QCOMPARE(body.value(QLatin1String("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QLatin1String("billable")).toBool(), true);
    }

    void flushesBeforeTheConnectionChanges()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const QByteArray authorization = f.transport.requests.first().authorization;
        QVERIFY(!authorization.isEmpty());
        QVERIFY(f.session->setPomodoroMode(true));
        const QDateTime at = f.clock.now();
        QVERIFY(start(f));
        const QString owner = f.connection.owner();
        tick(f, 100);

        // The session ends at the change, and its pomodoro is posted with
        // the old credentials before the new generation aborts the rest.
        f.credentials.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(instanceB);
        QVERIFY(!f.session->isActive());
        QVERIFY(!f.connection.isConnected());
        QCOMPARE(f.posts(), 1);
        const qsizetype post = f.last("POST", entriesPath);
        QCOMPARE(post, before);
        QCOMPARE(f.transport.requests.at(post).authorization, authorization);
        QVERIFY(!f.transport.replies.at(post)->aborted);
        QCOMPARE(f.body(post).value(QLatin1String("start")).toString(), iso(at));
        QCOMPARE(f.body(post).value(QLatin1String("stop")).toString(), iso(at.addSecs(120)));
        const PomodoroRecord old = PomodoroRecord::fromJson(f.store.loadRecord(owner));
        QVERIFY(!old.session.has_value());
        QVERIFY(old.unsaved.isEmpty());
        QVERIFY(f.session->pomodoroMode());
        QVERIFY(!f.session->modeLocked());

        // The reply arrives after the change and changes nothing; the new
        // instance sends only its /me.
        f.respond(post, FakeTransport::answer(200, stoppedEntry(100, f.body(post))));
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == before + 2;
        }));
        QCOMPARE(f.transport.requests.at(before + 1).url.path(), QStringLiteral("/tokkl/api/v9/me"));
        QCOMPARE(f.posts(), 1);
        QVERIFY(PomodoroRecord::fromJson(f.store.loadRecord(owner)).unsaved.isEmpty());
    }

    void formatsTheCountdown_data()
    {
        QTest::addColumn<qint64>("seconds");
        QTest::addColumn<bool>("overtime");
        QTest::addColumn<QString>("text");
        QTest::newRow("zero") << qint64(0) << false << QStringLiteral("0:00");
        QTest::newRow("under a minute") << qint64(59) << false << QStringLiteral("0:59");
        QTest::newRow("minutes") << qint64(1500) << false << QStringLiteral("25:00");
        QTest::newRow("over an hour") << qint64(3605) << false << QStringLiteral("60:05");
        QTest::newRow("overtime") << qint64(65) << true << QStringLiteral("+1:05");
        QTest::newRow("overtime zero") << qint64(0) << true << QStringLiteral("+0:00");
        QTest::newRow("negative") << qint64(-7) << false << QStringLiteral("0:00");
    }

    void formatsTheCountdown()
    {
        QFETCH(qint64, seconds);
        QFETCH(bool, overtime);
        QFETCH(QString, text);
        QCOMPARE(PomodoroSession::formatCountdown(seconds, overtime), text);
    }
};

QTEST_GUILESS_MAIN(PomodoroSessionTest)
#include "pomodorosessiontest.moc"
