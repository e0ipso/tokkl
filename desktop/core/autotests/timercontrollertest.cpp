#include "connection.h"
#include "fakes.h"
#include "projectcatalog.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>
#include <QTranslator>

using namespace Tokkl;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test/tokkl");
const QString token = QStringLiteral("tok-timer-1");
const QByteArray statePath = "/app/timer";
const QByteArray listPath = "/app/time_entries/latest";
const QByteArray startPath = "/app/timer/start";
const QByteArray stopPath = "/app/timer/stop";
const QByteArray editPath = "/app/timer/edit";
// The v9 create route, which a start never uses.
const QByteArray v9StartPath = "/v9/workspaces/7/time_entries";

QJsonObject entryObject(qint64 id, qint64 workspace, const QString &start, bool running = true, std::optional<qint64> project = std::nullopt)
{
    const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), workspace},
        {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
        {QStringLiteral("billable"), false},
        {QStringLiteral("start"), start},
        {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(begin.addSecs(60).toString(Qt::ISODate))},
        {QStringLiteral("duration"), running ? -begin.toSecsSinceEpoch() : 60},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
}

QByteArray entryBody(qint64 id, qint64 workspace, const QString &start, bool running = true, std::optional<qint64> project = std::nullopt)
{
    return QJsonDocument(entryObject(id, workspace, start, running, project)).toJson(QJsonDocument::Compact);
}

QJsonObject listedEntry(qint64 id, qint64 workspace, std::optional<qint64> project, const QJsonValue &active, bool billable = false)
{
    QJsonObject entry = entryObject(id, workspace, QStringLiteral("2026-10-15T08:00:00Z"), false, project);
    entry.insert(QStringLiteral("project_active"), active);
    entry.insert(QStringLiteral("project_billable"), project ? QJsonValue(billable) : QJsonValue(QJsonValue::Null));
    return entry;
}

// GET /api/app/time_entries/latest: the newest of entries, or null.
QByteArray listBody(const QJsonArray &entries)
{
    return entries.isEmpty() ? QByteArray("null") : QJsonDocument(entries.first().toObject()).toJson(QJsonDocument::Compact);
}

QByteArray projectsBody(qint64 workspace)
{
    return QStringLiteral(R"([{"id":11,"workspace_id":%1,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])")
        .arg(workspace)
        .toUtf8();
}

QJsonObject projectObject(qint64 id, qint64 workspace, const QString &color, bool active = true)
{
    return QJsonObject{{QStringLiteral("id"), id},
                       {QStringLiteral("workspace_id"), workspace},
                       {QStringLiteral("name"), QStringLiteral("P%1").arg(id)},
                       {QStringLiteral("color"), color},
                       {QStringLiteral("active"), active},
                       {QStringLiteral("billable"), false}};
}

// Active projects with ids first .. first + count - 1.
QByteArray projectPage(int first, int count, qint64 workspace)
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

const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z"); // 65 s before the fake clock

// Project 11 is billable by default; the entry is not. A duration stops it.
QByteArray detailedEntry(qint64 id, const QString &start, std::optional<qint64> duration = std::nullopt)
{
    QJsonObject entry = entryObject(id, 7, start, !duration, 11);
    entry.insert(QStringLiteral("description"), QStringLiteral("Write the report"));
    entry.insert(QStringLiteral("task_id"), 4);
    entry.insert(QStringLiteral("tags"), QJsonArray{QStringLiteral("focus"), QStringLiteral("client")});
    if (duration) {
        const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
        entry.insert(QStringLiteral("stop"), begin.addSecs(*duration).toString(Qt::ISODate));
        entry.insert(QStringLiteral("duration"), *duration);
    }
    return json(entry);
}

// The server's pause chain of the detailed entry; no clone while paused.
QJsonObject pauseObject(bool paused, qint64 seconds, std::optional<qint64> clone = std::nullopt, qint64 workspace = 7)
{
    return QJsonObject{
        {QStringLiteral("paused"), paused},
        {QStringLiteral("seconds"), seconds},
        {QStringLiteral("workspace_id"), workspace},
        {QStringLiteral("description"), QStringLiteral("Write the report")},
        {QStringLiteral("project_id"), 11},
        {QStringLiteral("task_id"), 4},
        {QStringLiteral("tag_ids"), QJsonArray{3, 5}},
        {QStringLiteral("tags"), QJsonArray{QStringLiteral("client"), QStringLiteral("focus")}},
        {QStringLiteral("billable"), false},
        {QStringLiteral("clone_entry_id"), clone ? QJsonValue(*clone) : QJsonValue(QJsonValue::Null)},
    };
}

QJsonObject pomodoroObject(qint64 entry, const QString &start)
{
    const QDateTime begin = QDateTime::fromString(start, Qt::ISODate);
    return QJsonObject{
        {QStringLiteral("work_minutes"), 25},
        {QStringLiteral("short_rest_minutes"), 5},
        {QStringLiteral("long_rest_minutes"), 15},
        {QStringLiteral("long_rest_every"), 4},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), QStringLiteral("work")},
             {QStringLiteral("start"), start},
             {QStringLiteral("completed"), 0},
             {QStringLiteral("planned_end"), begin.addSecs(25 * 60).toString(Qt::ISODate)},
         }},
        {QStringLiteral("upcoming_phase"), QStringLiteral("shortRest")},
        {QStringLiteral("transition"), QStringLiteral("workToShortRest")},
        {QStringLiteral("number"), 1},
        {QStringLiteral("entry_id"), entry},
        {QStringLiteral("pomodoro_start"), start},
    };
}

// running is the running entry as JSON, "null" for none.
QByteArray stateJson(qint64 revision, const QDateTime &serverTime, const QByteArray &running, const QJsonValue &pause, const QJsonValue &pomodoro)
{
    return json(QJsonObject{
        {QStringLiteral("revision"), revision},
        {QStringLiteral("server_time"), serverTime.toUTC().toString(Qt::ISODateWithMs)},
        {QStringLiteral("running_entry"), parseJsonBody(running).value_or(QJsonValue())},
        {QStringLiteral("pause"), pause},
        {QStringLiteral("pomodoro"), pomodoro},
        {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
    });
}

QByteArray revisionBody(qint64 revision)
{
    return "{\"revision\":" + QByteArray::number(revision) + "}";
}

QString clockText(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODate);
}
}

// Translates only one context's messages, as "[context] source".
class ContextTranslator : public QTranslator
{
public:
    explicit ContextTranslator(const char *context)
        : m_context(context)
    {
    }

    QString translate(const char *context, const char *sourceText, const char *, int) const override
    {
        if (qstrcmp(context, m_context) != 0) {
            return QString();
        }
        return QLatin1Char('[') + QLatin1String(context) + QStringLiteral("] ") + QString::fromUtf8(sourceText);
    }

    bool isEmpty() const override
    {
        return false;
    }

private:
    const char *m_context;
};

class TimerControllerTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        Connection connection{&transport, &store, clock, testClientName()};
        TimerStateClient state{connection, clock};
        TimerController timer{state};
        QSet<qsizetype> answered;
        qint64 revision = 0; // of the last state built

        Fixture()
        {
            transport.status = FakeTransport::currentStatus();
        }

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

        QByteArray nextState(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            return stateJson(++revision, clock.now(), running, pause, pomodoro);
        }

        HttpResponse stateAnswer(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            return FakeTransport::answer(200, nextState(running, pause, pomodoro));
        }

        // False when the latest state read was answered already.
        bool answerState(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            const qsizetype read = last("GET", statePath);
            if (!unanswered(read)) {
                return false;
            }
            respond(read, stateAnswer(running, pause, pomodoro));
            return true;
        }

        bool push(const QByteArray &running = "null", const QJsonValue &pause = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null)
        {
            FakeStream *stream = transport.lastStream();
            if (!stream) {
                return false;
            }
            stream->push("event: timer\ndata: " + nextState(running, pause, pomodoro) + "\n\n");
            return true;
        }

        qsizetype stateReads() const
        {
            return find("GET", statePath).size();
        }

        qsizetype otherRequests() const
        {
            return transport.requests.size() - stateReads();
        }

        // The list read sent once the revision answers; -1 when none comes.
        qsizetype listRead()
        {
            if (!QTest::qWaitFor([this] {
                    return unanswered(last("GET", "/projects"));
                })) {
                return -1;
            }
            return last("GET", "/projects");
        }

        bool answerList(const HttpResponse &response)
        {
            const qsizetype read = listRead();
            if (read < 0) {
                return false;
            }
            respond(read, response);
            return true;
        }

        bool answerList(const QByteArray &projects)
        {
            return answerList(FakeTransport::answer(200, projects));
        }

        // The next catalog read answers a new revision.
        void changeCatalog()
        {
            transport.catalog = FakeTransport::catalogAt(++catalogRevision);
        }

        qint64 catalogRevision = 1;
    };

    // Token auth, then answers /me and the state and projects reads it sends.
    static bool connectAccount(Fixture &f,
                               const QString &url = instanceA,
                               qint64 userId = 3,
                               qint64 workspace = 7,
                               const QByteArray &current = entryBody(5, 7, startedAt),
                               const QJsonValue &pause = QJsonValue::Null,
                               const QJsonValue &pomodoro = QJsonValue::Null,
                               const QByteArray &projects = QByteArray())
    {
        f.store.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        const qsizetype before = f.transport.requests.size();
        f.connection.setInstanceUrl(url);
        if (!QTest::qWaitFor([&] {
                return f.transport.requests.size() == before + 1;
            })) {
            return false;
        }
        f.respond(before, FakeTransport::answer(200, meBody(userId, workspace)));
        const qsizetype read = f.last("GET", statePath);
        const qsizetype projectsRead = f.listRead();
        if (!f.unanswered(read) || projectsRead < 0) {
            return false;
        }
        f.respond(read, f.stateAnswer(current, pause, pomodoro));
        f.respond(projectsRead, FakeTransport::answer(200, projects.isEmpty() ? projectsBody(workspace) : projects));
        return f.timer.isConnected();
    }

    // Thirty one-second ticks, so the state client polls again.
    static void poll(Fixture &f)
    {
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
    }

    static bool pauseEntry(Fixture &f, qint64 seconds)
    {
        const QByteArray shown = json(QJsonObject{{QStringLiteral("revision"), f.revision}});
        if (!f.timer.isRunning() || !f.timer.toggle()) {
            return false;
        }
        const qsizetype post = f.last("POST", "/timer/pause");
        if (!f.unanswered(post) || f.transport.requests.at(post).body != shown) {
            return false;
        }
        f.respond(post, f.stateAnswer("null", pauseObject(true, seconds)));
        return f.timer.isPaused() && !f.timer.isRunning() && !f.timer.isBusy();
    }

    static bool resumeEntry(Fixture &f, qint64 id, qint64 seconds)
    {
        const qint64 shown = f.revision;
        if (!f.timer.isPaused() || !f.timer.toggle()) {
            return false;
        }
        const qsizetype post = f.last("POST", "/timer/resume");
        if (!f.unanswered(post) || f.transport.requests.at(post).body != revisionBody(shown)) {
            return false;
        }
        f.respond(post, f.stateAnswer(detailedEntry(id, clockText(f.clock.now())), pauseObject(false, seconds, id)));
        return f.timer.isRunning() && !f.timer.isPaused() && !f.timer.isBusy() && f.timer.currentEntry()->id == id;
    }

    static bool refuseStart(Fixture &f)
    {
        const qsizetype post = f.last("POST", startPath);
        if (!f.unanswered(post)) {
            return false;
        }
        const qsizetype others = f.otherRequests();
        f.respond(post, FakeTransport::answer(404, "\"Project not found\""));
        return f.otherRequests() == others;
    }

private Q_SLOTS:
    void chosenProjectLabelFollowsTheChoice()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        QCOMPARE(f.timer.chosenProjectLabel().name, QStringLiteral("Alpha"));
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(200, entryBody(5, 7, startedAt, false, 11)));
        QVERIFY(f.answerState("null"));
        QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QCOMPARE(f.timer.chosenProjectLabel(), ProjectLabelParts());
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.chosenProjectLabel().name, QStringLiteral("Alpha"));
        QCOMPARE(f.timer.chosenProjectLabel().kind, ProjectLabelParts::Kind::Named);
        QCOMPARE(f.timer.chosenProjectLabelVariant().value(QStringLiteral("name")).toString(), QStringLiteral("Alpha"));
        QCOMPARE(f.timer.chosenProjectLabelVariant().value(QStringLiteral("kind")).toString(), QStringLiteral("named"));
        for (const QVariant &refused : {QVariant(33), QVariant(-1), QVariant(QStringLiteral("eleven"))}) {
            QVERIFY(!f.timer.chooseProject(refused));
        }
        QVERIFY(f.timer.chooseProject(0));
        QVERIFY(f.timer.chosenProjectId().isNull());
    }

    void exposesContextAndEntry()
    {
        Fixture f;
        QVERIFY(!f.timer.isConnected());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(f.transport.requests.isEmpty());

        QVERIFY(connectAccount(f));
        QCOMPARE(f.timer.workspaceId(), 7);
        QCOMPARE(f.timer.account().value(QStringLiteral("id")).toLongLong(), 3);
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntryVariant().toMap().value(QStringLiteral("id")).toLongLong(), 5);
        QCOMPARE(f.timer.projects().size(), 1);
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QVERIFY(f.timer.canWrite());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isStale());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01"));
    }

    // QML and the panels change the choices only through chooseProject() and
    // chooseBillable(), which check the rules.
    void choicesAreReadOnly()
    {
        for (const char *name : {"chosenProjectId", "chosenBillable"}) {
            const int index = TimerController::staticMetaObject.indexOfProperty(name);
            QVERIFY2(index >= 0, name);
            QVERIFY2(!TimerController::staticMetaObject.property(index).isWritable(), name);
        }
        for (const char *name : {"selectedProjectId", "billable"}) {
            QVERIFY2(TimerController::staticMetaObject.indexOfProperty(name) < 0, name);
        }

        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QSignalSpy selection(&f.timer, &TimerController::selectionChanged);
        QVERIFY(!f.timer.setProperty("chosenProjectId", 11));
        QVERIFY(!f.timer.setProperty("chosenBillable", true));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QCOMPARE(selection.count(), 0);
    }

    void formatsElapsed()
    {
        QCOMPARE(TimerController::formatElapsed(-5), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(0), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(59), QStringLiteral("0:00"));
        QCOMPARE(TimerController::formatElapsed(60), QStringLiteral("0:01"));
        QCOMPARE(TimerController::formatElapsed(3599), QStringLiteral("0:59"));
        QCOMPARE(TimerController::formatElapsed(3600), QStringLiteral("1:00"));
        QCOMPARE(TimerController::formatElapsed(3600 + 61), QStringLiteral("1:01"));
        QCOMPARE(TimerController::formatElapsed(125 * 3600), QStringLiteral("125:00"));
    }

    void systemClockTicksEverySecond()
    {
        SystemClock clock;
        QList<qint64> ticks;
        connect(&clock, &Clock::ticked, this, [&ticks] {
            ticks.append(QDateTime::currentMSecsSinceEpoch());
        });
        QVERIFY(QTest::qWaitFor(
            [&] {
                return ticks.size() >= 3;
            },
            5000));
        // Re-aimed at each second boundary, so the interval stays near 1 s.
        for (qsizetype i = 1; i < ticks.size(); ++i) {
            const qint64 interval = ticks.at(i) - ticks.at(i - 1);
            QVERIFY2(interval > 500 && interval < 1500, qPrintable(QString::number(interval)));
        }
        QVERIFY(qAbs(clock.now().msecsTo(QDateTime::currentDateTimeUtc())) < 1000);
        QCOMPARE(clock.now().timeSpec(), Qt::UTC);
    }

    void ticksFromTheServerStartWithoutDrift()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QSignalSpy elapsed(&f.timer, &TimerController::elapsedChanged);

        const QDateTime start = QDateTime::fromString(startedAt, Qt::ISODate);
        for (int i = 0; i < 25; ++i) {
            f.clock.advance(i % 2 ? 1400 : 700);
            QCOMPARE(f.timer.elapsedSeconds(), start.secsTo(f.clock.current));
        }
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 25); // 25 ticks covered 25.9 s
        QVERIFY(elapsed.count() > 0);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:01"));

        f.clock.current = start.addSecs(-30);
        f.clock.advance(0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
    }

    void sleepGapKeepsTimeAndRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.clock.advance(1000);
        const qsizetype requests = f.transport.requests.size();

        const qsizetype streams = f.transport.streams.size();
        const qsizetype catalogReads = f.transport.catalogRequests.size();
        f.clock.advance(2 * 3600 * 1000);
        QCOMPARE(f.timer.elapsedSeconds(), 2 * 3600 + 66);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("2:01"));
        QCOMPARE(f.transport.requests.size(), requests + 1);
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QCOMPARE(f.transport.streams.size(), streams + 1);
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads + 1);

        f.state.resumed();
        QCOMPARE(f.transport.requests.size(), requests + 1);
        QCOMPARE(f.transport.streams.size(), streams + 1);
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads + 1);

        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
    }

    void wakeNoticeBeforeTheLateTickCountsOnce()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        f.clock.advance(1000);
        const qsizetype requests = f.transport.requests.size();
        const qsizetype streams = f.transport.streams.size();
        const qsizetype catalogReads = f.transport.catalogRequests.size();

        f.clock.current = f.clock.current.addSecs(2 * 3600);
        f.state.resumed();
        QCOMPARE(f.transport.requests.size(), requests + 1);
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QCOMPARE(f.transport.streams.size(), streams + 1);
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads + 1);

        f.clock.advance(1000);
        QCOMPARE(f.transport.requests.size(), requests + 1);
        QCOMPARE(f.transport.streams.size(), streams + 1);
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads + 1);
    }

    void pollsWhileNoStreamDelivers()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(!f.timer.isRunning());
        const qsizetype reads = f.find("GET", statePath).size();

        for (int i = 0; i < 29; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads);
        f.clock.advance(1000);
        QCOMPARE(f.find("GET", statePath).size(), reads + 1);

        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T09:00:10Z"))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 9);
        QCOMPARE(f.timer.elapsedSeconds(), 20);

        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 2);
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 2);

        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QCOMPARE(f.timer.elapsedSeconds(), 3690);
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:01"));

        // A clock set far back counts as a resume and reads at once.
        f.clock.current = f.clock.current.addSecs(-20);
        f.clock.advance(0);
        QCOMPARE(f.find("GET", statePath).size(), reads + 3);

        QVERIFY(f.answerState(entryBody(9, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QVERIFY(f.push());
        QVERIFY(!f.timer.isRunning());
        for (int i = 0; i < 90; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.find("GET", statePath).size(), reads + 3);
    }

    void startWaitsForTheFirstStateRead()
    {
        Fixture f;
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.timer.isConnected());

        // The first read has not answered: a server timer may be running.
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QVERIFY(f.answerList(projectsBody(7)));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QCOMPARE(f.find("POST", startPath).size(), 0);

        f.respond(f.last("GET", statePath), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QCOMPARE(f.find("POST", startPath).size(), 0);

        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        QVERIFY(f.answerState("null"));
        if (f.unanswered(f.last("GET", "/projects"))) {
            f.respond(f.last("GET", "/projects"), FakeTransport::answer(200, projectsBody(7)));
        }
        QVERIFY(f.timer.canWrite());
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", startPath).size(), 1);
    }

    void startSendsTheAgreedEntry()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceB, 3, 7, "null"));
        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chooseBillable(true));
        f.clock.current = QDateTime(QDate(2026, 10, 16), QTime(9, 15, 30), QTimeZone::fromSecondsAheadOfUtc(7200)).toUTC();

        QSignalSpy status(&f.timer, &TimerController::statusChanged);
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", startPath).size(), 1);

        const qsizetype post = f.last("POST", startPath);
        const HttpRequest request = f.transport.requests.at(post);
        QCOMPARE(request.url.toString(), QStringLiteral("https://b.example.test/tokkl/api/app/timer/start"));
        const QJsonObject body = QJsonDocument::fromJson(request.body).object();
        // Against the revision shown, so a start made elsewhere first is
        // refused rather than replaced.
        QCOMPARE(body.value(QStringLiteral("revision")).toInteger(), f.revision);
        QVERIFY(!body.contains(QStringLiteral("duration")));
        QCOMPARE(body.value(QStringLiteral("start")).toString(), QStringLiteral("2026-10-16T07:15:30Z"));
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), testClientName());
        QVERIFY(body.value(QStringLiteral("description")).isString());
        QCOMPARE(body.value(QStringLiteral("description")).toString(), QString());
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(body.value(QStringLiteral("workspace_id")).toInteger(), 7);

        const qsizetype reads = f.stateReads();
        f.respond(post, f.stateAnswer(entryBody(21, 7, QStringLiteral("2026-10-16T07:15:30Z"))));
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.currentEntry()->id, 21);
        QCOMPARE(f.stateReads(), reads);

        // Nonbillable and no project are sent explicitly too.

        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QVERIFY(f.timer.start());
        const QJsonObject plain = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", startPath)).body).object();
        QVERIFY(plain.value(QStringLiteral("project_id")).isNull());
        QVERIFY(plain.contains(QStringLiteral("billable")));
        QCOMPARE(plain.value(QStringLiteral("billable")).toBool(true), false);
    }

    void stopShowsTheStateItAnswers()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const qsizetype reads = f.stateReads();
        QVERIFY(f.timer.stop());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", stopPath).size(), 1);
        const HttpRequest request = f.transport.requests.at(f.last("POST", stopPath));
        QCOMPARE(request.url.path(), QStringLiteral("/api/app/timer/stop"));
        QCOMPARE(request.body, revisionBody(f.revision));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());

        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));
        QCOMPARE(f.find("POST", stopPath).size(), 1);
        QCOMPARE(f.stateReads(), reads);
    }

    // The messages use the controller's own context, where lupdate files them.
    void messagesUseTheControllersContext()
    {
        ContextTranslator translator("Tokkl::TimerController");
        QVERIFY(QCoreApplication::installTranslator(&translator));
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), FakeTransport::answer(409, f.nextState(entryBody(30, 7, clockText(f.clock.now().addSecs(-4)), true, 11))));
        QCOMPARE(f.timer.errorString(), QStringLiteral("[Tokkl::TimerController] The timer changed on another device first."));
    }

    // The start goes against the revision shown, so the server refuses it with
    // its state. Nothing is sent again; the message stays until the next action.
    void startConflictAdoptsTheServerState()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qint64 shown = f.revision;
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", startPath);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(post).body).object().value(QStringLiteral("revision")).toInteger(), shown);
        f.respond(post, FakeTransport::answer(409, f.nextState(entryBody(30, 7, clockText(f.clock.now().addSecs(-4)), true, 11))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 30);
        QCOMPARE(f.timer.elapsedSeconds(), 4);
        QCOMPARE(f.timer.errorString(), QStringLiteral("The timer changed on another device first."));
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.timer.canWrite());

        poll(f);
        QVERIFY(f.answerState(entryBody(30, 7, clockText(f.clock.now().addSecs(-34)), true, 11)));
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", startPath).size(), 1);
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);
        QCOMPARE(f.find("POST", startPath).size(), 1);
    }

    // A server below the floor binds no account: no write or timer read goes out.
    void olderServerIsTooOld()
    {
        Fixture f;
        f.transport.status = FakeTransport::olderStatus();
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QTRY_COMPARE(f.transport.requests.size(), 1);
        f.respond(0, FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.timer.status(), TimerController::Error);
        QCOMPARE(f.timer.errorString(), QStringLiteral("This Tokkl server is too old for this app; update the server."));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.start());
        QCOMPARE(f.transport.requests.size(), 1);

        f.transport.status = FakeTransport::currentStatus();
        f.timer.reconnect();
        QTRY_COMPARE(f.transport.requests.size(), 2);
        QCOMPARE(f.transport.statusRequests.size(), 2);
        f.respond(1, FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.timer.isConnected());
    }

    // On a current server a 404 from the app stop is a refusal: nothing goes to v9.
    void notFoundOnTheAppStopIsARefusal()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(404, "\"Time entry not found\""));
        QVERIFY(f.find("PATCH", "/stop").isEmpty());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.errorString(), QStringLiteral("Time entry not found"));
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QVERIFY(f.timer.stop());
        QCOMPARE(f.find("POST", stopPath).size(), 2);
        QVERIFY(f.find("PATCH", "/stop").isEmpty());
    }

    void pauseAndResumeKeepTheChainTotal()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.resume());
        QVERIFY(!f.timer.pause());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);
        const qsizetype pause = f.last("POST", "/timer/pause");
        QCOMPARE(f.transport.requests.at(pause).url.path(), QStringLiteral("/api/app/timer/pause"));
        QCOMPARE(f.transport.requests.at(pause).body, json(QJsonObject{{QStringLiteral("revision"), f.revision}}));
        QVERIFY(f.find("POST", stopPath).isEmpty());
        f.respond(pause, f.stateAnswer("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(chain.count() > 0);
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.elapsedText(), TimerController::formatElapsed(65));

        for (int i = 0; i < 10; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        QVERIFY(resumeEntry(f, 6, 65));
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QVERIFY(f.find("POST", startPath).isEmpty());
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        for (int i = 0; i < 5; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 70);
        QCOMPARE(f.timer.chainSeconds(), 65);

        // The server added what it stored for the clone.
        QVERIFY(pauseEntry(f, 69));
        QCOMPARE(f.timer.chainSeconds(), 69);
        QCOMPARE(f.timer.elapsedSeconds(), 69);
        QVERIFY(resumeEntry(f, 7, 69));
        for (int i = 0; i < 3; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 72);

        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("POST", stopPath)).body, revisionBody(f.revision));
        f.respond(f.last("POST", stopPath), f.stateAnswer());
        QVERIFY(!f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        QVERIFY(f.timer.toggle());
        const QJsonObject fresh = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", startPath)).body).object();
        QCOMPARE(fresh.value(QStringLiteral("description")).toString(), QString());
        QVERIFY(!fresh.contains(QStringLiteral("task_id")));
        QVERIFY(!fresh.contains(QStringLiteral("tags")));
        QCOMPARE(fresh.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(fresh.value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(f.find("POST", stopPath).size(), 1);
        QCOMPARE(f.find("POST", "/timer/pause").size(), 2);
        QCOMPARE(f.find("POST", "/timer/resume").size(), 2);
    }

    void chainTotalComesFromTheState()
    {
        Fixture f;
        const QString cloneStart = clockText(f.clock.now().addSecs(-10));
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(6, cloneStart), pauseObject(false, 65, 6)));
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 75);

        // The server's clock runs 5 s ahead of this one.
        poll(f);
        f.respond(f.last("GET", statePath),
                  FakeTransport::answer(200, stateJson(++f.revision, f.clock.now().addSecs(5), detailedEntry(6, cloneStart), pauseObject(false, 65, 6), QJsonValue::Null)));
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 40 + 5);
        f.clock.advance(1000);
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 41 + 5);

        poll(f);
        QVERIFY(f.answerState("null", pauseObject(true, 110)));
        QCOMPARE(f.timer.chainSeconds(), 110);
        QCOMPARE(f.timer.elapsedSeconds(), 110);
    }

    void choicesAreLockedWhilePaused()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QSignalSpy choice(&f.timer, &TimerController::choiceChanged);
        QVERIFY(pauseEntry(f, 65));
        QVERIFY(choice.count() > 0);
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.timer.chosenBillable(), false);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.chosenProjectLabel().name, QStringLiteral("Alpha"));

        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QVERIFY(!f.timer.chooseProject(11));
        QVERIFY(!f.timer.chooseBillable(true));
        QVERIFY(!f.timer.start());
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.timer.chosenBillable(), false);

        const qint64 shown = f.revision;
        QVERIFY(f.timer.stop());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.find("POST", "/timer/discard").size(), 1);
        const qsizetype discard = f.last("POST", "/timer/discard");
        QCOMPARE(f.transport.requests.at(discard).url.path(), QStringLiteral("/api/app/timer/discard"));
        QCOMPARE(f.transport.requests.at(discard).body, revisionBody(shown));
        f.respond(discard, f.stateAnswer());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        QCOMPARE(f.timer.chosenBillable(), true);
        QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(f.timer.chooseBillable(true));
        QVERIFY(f.timer.chosenBillable());
        QCOMPARE(f.timer.chosenProjectLabel().kind, ProjectLabelParts::Kind::None);
        QCOMPARE(f.transport.requests.size(), requests + 1);
    }

    void refusedResumeStaysPaused()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));

        QVERIFY(f.timer.resume());
        f.respond(f.last("POST", "/timer/resume"), FakeTransport::answer(404, "\"Project not found\""));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.answerState("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        poll(f);
        QVERIFY(f.answerState("null", pauseObject(true, 65)));
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QVERIFY(f.timer.isPaused());
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));

        QVERIFY(f.timer.stop());
        QCOMPARE(f.timer.errorString(), QString());
        f.respond(f.last("POST", "/timer/discard"), f.stateAnswer());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", startPath).size(), 1);
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
    }

    void conflictAdoptsTheServerState()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        const qint64 shown = f.revision;
        QVERIFY(f.timer.resume());
        const qsizetype post = f.last("POST", "/timer/resume");
        QCOMPARE(f.transport.requests.at(post).body, revisionBody(shown));
        f.respond(post, FakeTransport::answer(409, f.nextState(detailedEntry(6, clockText(f.clock.now().addSecs(-4))), pauseObject(false, 65, 6))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.currentEntry()->id, 6);
        QCOMPARE(f.timer.elapsedSeconds(), 69);
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.timer.canWrite());

        poll(f);
        QVERIFY(f.answerState(detailedEntry(6, clockText(f.clock.now().addSecs(-34))), pauseObject(false, 65, 6)));
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);

        QVERIFY(f.timer.toggle());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/pause").size(), 2);
    }

    void refusedStartKeepsItsMessage()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        QVERIFY(refuseStart(f));
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QCOMPARE(f.timer.status(), TimerController::Error);
        QVERIFY(f.timer.canWrite());

        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.errorString(), QString());
        QCOMPARE(f.timer.status(), TimerController::Ready);

        QVERIFY(f.timer.start());
        QVERIFY(refuseStart(f));
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.timer.errorString(), QStringLiteral("Project not found"));
        QVERIFY(f.timer.start());
        QCOMPARE(f.timer.errorString(), QString());
        QCOMPARE(f.find("POST", startPath).size(), 3);
        f.respond(f.last("POST", startPath), f.stateAnswer(entryBody(21, 7, clockText(f.clock.now()))));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.find("POST", v9StartPath).isEmpty());
        QCOMPARE(f.timer.errorString(), QString());
        QCOMPARE(f.timer.status(), TimerController::Ready);
    }

    void ambiguousResumeIsNeverReplayed_data()
    {
        QTest::addColumn<bool>("created");
        QTest::newRow("clone created") << true;
        QTest::newRow("nothing created") << false;
    }

    void ambiguousResumeIsNeverReplayed()
    {
        QFETCH(bool, created);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        const QString resumedAt = clockText(f.clock.now());
        QVERIFY(f.timer.resume());
        f.respond(f.last("POST", "/timer/resume"), FakeTransport::failure(HttpResponse::Outcome::Timeout, QStringLiteral("timed out")));
        QVERIFY(f.timer.isBusy());
        QCOMPARE(f.timer.status(), TimerController::Busy);
        QVERIFY(!f.timer.errorString().isEmpty());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());

        if (created) {
            QVERIFY(f.answerState(detailedEntry(6, resumedAt), pauseObject(false, 65, 6)));
        } else {
            QVERIFY(f.answerState("null", pauseObject(true, 65)));
        }
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QCOMPARE(f.timer.isRunning(), created);
        QCOMPARE(f.timer.isPaused(), !created);
        QCOMPARE(f.timer.chainSeconds(), 65);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        poll(f);
        if (created) {
            QVERIFY(f.answerState(detailedEntry(6, resumedAt), pauseObject(false, 65, 6)));
        } else {
            QVERIFY(f.answerState("null", pauseObject(true, 65)));
        }
        QCOMPARE(f.find("POST", "/timer/resume").size(), 1);
        QCOMPARE(f.timer.elapsedSeconds(), created ? 95 : 65);
    }

    // The poll may have been answered before the pause, so only a read sent
    // after the failure settles it.
    void unansweredPauseIsSettledByTheNextState_data()
    {
        QTest::addColumn<bool>("paused");
        QTest::newRow("the server paused") << true;
        QTest::newRow("nothing happened") << false;
    }

    void unansweredPauseIsSettledByTheNextState()
    {
        QFETCH(bool, paused);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        poll(f);
        const qsizetype early = f.last("GET", statePath);
        QVERIFY(f.unanswered(early));
        QVERIFY(f.timer.toggle());
        f.respond(f.last("POST", "/timer/pause"), FakeTransport::failure(HttpResponse::Outcome::Timeout, QStringLiteral("timed out")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QVERIFY(f.timer.isRunning());

        f.respond(early, f.stateAnswer(detailedEntry(5, startedAt)));
        QVERIFY(f.timer.isBusy());
        const qsizetype later = f.last("GET", statePath);
        QVERIFY(later > early);
        QVERIFY(f.unanswered(later));
        f.respond(later, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("reset")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.toggle());

        poll(f);
        if (paused) {
            QVERIFY(f.answerState("null", pauseObject(true, 66)));
        } else {
            QVERIFY(f.answerState(detailedEntry(5, startedAt)));
        }
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.isPaused(), paused);
        QCOMPARE(f.timer.isRunning(), !paused);
        QCOMPARE(f.timer.elapsedSeconds(), paused ? 66 : QDateTime::fromString(startedAt, Qt::ISODate).secsTo(f.clock.now()));
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);

        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", "/timer/resume").size(), paused ? 1 : 0);
        QCOMPARE(f.find("POST", "/timer/pause").size(), paused ? 1 : 2);
    }

    void unknownWriteIsNeverReplayed_data()
    {
        QTest::addColumn<QString>("write");
        QTest::newRow("stop") << QStringLiteral("stop");
        QTest::newRow("discard") << QStringLiteral("discard");
        QTest::newRow("billable") << QStringLiteral("billable");
    }

    void unknownWriteIsNeverReplayed()
    {
        QFETCH(QString, write);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QByteArray method = "POST";
        QByteArray path = stopPath;
        if (write == QLatin1String("discard")) {
            QVERIFY(pauseEntry(f, 65));
            QVERIFY(f.timer.stop());
            method = "POST";
            path = "/timer/discard";
        } else if (write == QLatin1String("billable")) {
            QVERIFY(f.timer.chooseBillable(true));
            path = editPath;
        } else {
            QVERIFY(f.timer.stop());
        }
        const qsizetype sent = f.last(method, path);
        QVERIFY(f.unanswered(sent));
        f.respond(sent, FakeTransport::answer(502, "\"Bad gateway\""));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.stop());
        QVERIFY(!f.timer.chooseBillable(false));

        QVERIFY(f.answerState(write == QLatin1String("billable") ? detailedEntry(5, startedAt) : QByteArray("null")));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find(method, path).size(), 1);
    }

    void otherDevicesArriveOnTheStream()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(f.push(detailedEntry(5, startedAt)));
        QVERIFY(f.state.streaming());
        const qsizetype reads = f.stateReads();

        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        QSignalSpy entry(&f.timer, &TimerController::currentEntryChanged);
        QVERIFY(f.push("null", pauseObject(true, 65)));
        QVERIFY(f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(chain.count(), 1);
        QCOMPARE(entry.count(), 1);
        QCOMPARE(f.timer.elapsedSeconds(), 65);
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(!f.timer.chosenBillable());
        poll(f);
        QCOMPARE(f.timer.elapsedSeconds(), 65);

        QVERIFY(f.push(detailedEntry(6, clockText(f.clock.now())), pauseObject(false, 65, 6)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 6);
        for (int i = 0; i < 5; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.elapsedSeconds(), 70);

        QVERIFY(f.push("null", pauseObject(true, 70, std::nullopt, 9)));
        QVERIFY(!f.timer.isPaused());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        QVERIFY(f.push());
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.stateReads(), reads);
        QVERIFY(f.find("POST", "/timer/pause").isEmpty());
    }

    // A session's open pomodoro is not a timer: nothing runs and actions do nothing.
    void sessionOwnsTheRunningEntry()
    {
        Fixture f;
        QSignalSpy session(&f.timer, &TimerController::sessionActiveChanged);
        const QString start = clockText(f.clock.now().addSecs(-120));
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(41, 7, start, true, 11), QJsonValue::Null, pomodoroObject(41, start)));
        QVERIFY(f.timer.isSessionActive());
        QCOMPARE(session.count(), 1);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isPaused());
        QVERIFY(f.timer.currentEntryVariant().isNull());
        QCOMPARE(f.timer.elapsedSeconds(), 0);

        const qsizetype requests = f.transport.requests.size();
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QVERIFY(!f.timer.pause());
        QVERIFY(!f.timer.resume());
        QCOMPARE(f.transport.requests.size(), requests);

        poll(f);
        QVERIFY(f.answerState());
        QVERIFY(!f.timer.isSessionActive());
        QCOMPARE(session.count(), 2);
        QVERIFY(f.timer.toggle());
        QCOMPARE(f.find("POST", startPath).size(), 1);
    }

    void newGenerationEndsTheChain_data()
    {
        QTest::addColumn<bool>("signOut");
        QTest::newRow("other instance") << false;
        QTest::newRow("secret removed") << true;
    }

    void newGenerationEndsTheChain()
    {
        QFETCH(bool, signOut);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, detailedEntry(5, startedAt)));
        QVERIFY(pauseEntry(f, 65));
        QSignalSpy chain(&f.timer, &TimerController::chainChanged);
        if (signOut) {
            const QString key = credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString());
            f.store.secrets.remove(key);
            Q_EMIT f.store.secretChanged(key);
        } else {
            f.connection.setInstanceUrl(instanceB);
        }
        QVERIFY(!f.timer.isPaused());
        QCOMPARE(f.timer.chainSeconds(), 0);
        QCOMPARE(f.timer.elapsedSeconds(), 0);
        QVERIFY(chain.count() > 0);
    }

    void projectIsLockedWhileRunning()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.timer.canWrite());
        const QVariantMap before = f.timer.currentEntryVariant().toMap();
        const qsizetype requests = f.transport.requests.size();
        QSignalSpy selection(&f.timer, &TimerController::selectionChanged);

        QVERIFY(!f.timer.chooseProject(11));
        QVERIFY(!f.timer.chooseProject(QVariant::fromValue(nullptr)));
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.timer.currentEntryVariant().toMap(), before);
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QCOMPARE(selection.count(), 0);
        QVERIFY(!f.timer.isBusy());

        QVERIFY(f.timer.chooseBillable(true));
        const qsizetype edit = f.last("POST", editPath);
        QVERIFY(f.unanswered(edit));
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(edit).body).object(),
                 QJsonObject({{QStringLiteral("billable"), true}, {QStringLiteral("entry_id"), 5}}));

        f.respond(edit, f.stateAnswer(entryBody(5, 7, startedAt)));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.find("POST", editPath).size(), 1);
        QVERIFY(f.find("PUT", "/time_entries/5").isEmpty());
    }

    void billableEditGoesThroughTheTimer()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        const qsizetype reads = f.stateReads();
        QVERIFY(f.timer.chooseBillable(true));
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.chooseBillable(false));
        const qsizetype edit = f.last("POST", editPath);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(edit).body).object(),
                 QJsonObject({{QStringLiteral("billable"), true}, {QStringLiteral("entry_id"), 5}}));

        QJsonObject edited = entryObject(5, 7, startedAt);
        edited.insert(QStringLiteral("billable"), true);
        f.respond(edit, f.stateAnswer(json(edited)));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.stateReads(), reads);
        QVERIFY(f.find("PUT", "/time_entries/5").isEmpty());
    }

    // The edit names its entry, so a change elsewhere that leaves it running
    // does not refuse it.
    void billableEditAppliesAfterAChangeElsewhere()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.push(entryBody(5, 7, startedAt)));
        QVERIFY(f.timer.chooseBillable(true));
        const qsizetype edit = f.last("POST", editPath);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(edit).body).object().value(QStringLiteral("entry_id")).toInteger(), 5);
        QVERIFY(!QJsonDocument::fromJson(f.transport.requests.at(edit).body).object().contains(QStringLiteral("revision")));
        QJsonObject edited = entryObject(5, 7, startedAt);
        edited.insert(QStringLiteral("billable"), true);
        f.respond(edit, f.stateAnswer(json(edited)));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.find("POST", editPath).size(), 1);
    }

    void billableEditConflictForAnotherEntry_data()
    {
        QTest::addColumn<QByteArray>("running");
        QTest::newRow("another entry") << entryBody(6, 7, startedAt);
        QTest::newRow("stopped") << QByteArray("null");
    }

    void billableEditConflictForAnotherEntry()
    {
        QFETCH(QByteArray, running);
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.chooseBillable(true));
        f.respond(f.last("POST", editPath), FakeTransport::answer(409, f.nextState(running)));
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.errorString(), QStringLiteral("The timer changed on another device first."));
        QCOMPARE(f.find("POST", editPath).size(), 1);
        QVERIFY(f.find("PUT", "/time_entries/5").isEmpty());
    }

    void panelStopDefaultsToTheEntryProject()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        QVERIFY(f.find("GET", listPath).isEmpty());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);

        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(f.timer.chosenBillable());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(f.find("GET", listPath).isEmpty());
        QVERIFY(f.timer.start());
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", startPath)).body).object();
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
    }

    void polledStopDefaultsToTheEntryProject()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        poll(f);
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(f.timer.chosenBillable());
    }

    void stopWithoutAnActiveProjectGivesNoProject_data()
    {
        QTest::addColumn<QByteArray>("running");
        QTest::addColumn<int>("lookupStatus");
        QTest::addColumn<QByteArray>("lookup");
        QTest::newRow("archived") << entryBody(5, 7, startedAt, true, 33) << 200
                                  << QJsonDocument(QJsonObject{{QStringLiteral("id"), 33},
                                                               {QStringLiteral("workspace_id"), 7},
                                                               {QStringLiteral("name"), QStringLiteral("Legacy")},
                                                               {QStringLiteral("active"), false},
                                                               {QStringLiteral("billable"), true}})
                                         .toJson(QJsonDocument::Compact);
        QTest::newRow("deleted") << entryBody(5, 7, startedAt, true, 44) << 404 << QByteArray("\"Project not found\"");
        QTest::newRow("no project") << entryBody(5, 7, startedAt) << 0 << QByteArray();
    }

    void stopWithoutAnActiveProjectGivesNoProject()
    {
        QFETCH(QByteArray, running);
        QFETCH(int, lookupStatus);
        QFETCH(QByteArray, lookup);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(f.push(running));
        if (lookupStatus != 0) {
            f.respond(f.last("GET", "/projects/" + QByteArray::number(lookupStatus == 200 ? 33 : 44)), FakeTransport::answer(lookupStatus, lookup));
        }

        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
    }

    void connectDefaultsToTheLastEntryProject_data()
    {
        QTest::addColumn<QByteArray>("list");
        QTest::addColumn<QVariant>("project");
        QTest::addColumn<bool>("billable");
        const QVariant none = QVariant::fromValue(nullptr);
        QTest::newRow("active") << listBody({listedEntry(8, 7, 11, true, true), listedEntry(6, 7, 12, true)}) << QVariant(qint64(11)) << true;
        QTest::newRow("active, nonbillable") << listBody({listedEntry(8, 7, 12, true, false)}) << QVariant(qint64(12)) << false;
        QTest::newRow("archived") << listBody({listedEntry(8, 7, 33, false, true), listedEntry(6, 7, 11, true)}) << none << false;
        QTest::newRow("unknown state") << listBody({listedEntry(8, 7, 11, QJsonValue::Null)}) << none << false;
        QTest::newRow("no project") << listBody({listedEntry(8, 7, std::nullopt, QJsonValue::Null), listedEntry(6, 7, 11, true)}) << none << false;
        QTest::newRow("another workspace") << listBody({listedEntry(8, 9, 11, true, true)}) << none << false;
        QTest::newRow("no entry") << listBody({}) << none << false;
    }

    void connectDefaultsToTheLastEntryProject()
    {
        QFETCH(QByteArray, list);
        QFETCH(QVariant, project);
        QFETCH(bool, billable);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QCOMPARE(f.find("GET", listPath).size(), 1);
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.unanswered(read));
        const QUrl url = f.transport.requests.at(read).url;
        QCOMPARE(url.path(), QStringLiteral("/api/app/time_entries/latest"));
        QVERIFY(url.query().isEmpty());

        QSignalSpy choice(&f.timer, &TimerController::choiceChanged);
        f.respond(read, FakeTransport::answer(200, list));
        const qsizetype reads = f.find("GET", listPath).size();
        QCOMPARE(reads, 1);
        if (project.isNull()) {
            QVERIFY(f.timer.chosenProjectId().isNull());
        } else {
            QCOMPARE(f.timer.chosenProjectId().toLongLong(), project.toLongLong());
            QVERIFY(choice.count() > 0);
        }
        QCOMPARE(f.timer.chosenBillable(), billable);

        QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        poll(f);
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.find("GET", listPath).size(), reads);
        QVERIFY(f.timer.chosenProjectId().isNull());
    }

    void connectWithARunningEntryAsksNothing()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        poll(f);
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QVERIFY(f.find("GET", listPath).isEmpty());
    }

    void manualPickWinsOverTheConnectDefault_data()
    {
        QTest::addColumn<QString>("pick");
        QTest::newRow("project") << QStringLiteral("project");
        QTest::newRow("billable") << QStringLiteral("billable");
    }

    void manualPickWinsOverTheConnectDefault()
    {
        QFETCH(QString, pick);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.unanswered(read));

        if (pick == QLatin1String("project")) {
            QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        } else {
            QVERIFY(f.timer.chooseBillable(true));
        }
        f.respond(read, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QCOMPARE(f.timer.chosenBillable(), pick == QLatin1String("billable"));

        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chooseBillable(false));
        poll(f);
        QVERIFY(f.answerState("null"));
        QCOMPARE(f.find("GET", listPath).size(), 1);
        QVERIFY(f.timer.start());
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(f.last("POST", startPath)).body).object();
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(true), false);
    }

    void startBeforeTheConnectDefaultKeepsItsChoice()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype read = f.last("GET", listPath);
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), f.stateAnswer(entryBody(21, 7, startedAt)));
        f.respond(read, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
    }

    void connectDefaultOfAnOlderGenerationIsIgnored()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        const qsizetype oldRead = f.last("GET", listPath);
        QVERIFY(connectAccount(f, instanceB, 4, 7, "null"));
        const qsizetype newRead = f.last("GET", listPath);
        QVERIFY(newRead > oldRead);
        f.respond(oldRead, FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        f.respond(newRead, FakeTransport::answer(200, listBody({listedEntry(9, 7, 11, true, false)})));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        QVERIFY(!f.timer.chosenBillable());
    }

    void stopBeforeTheProjectListKeepsItsDefault_data()
    {
        QTest::addColumn<bool>("pick");
        QTest::newRow("default") << false;
        QTest::newRow("manual pick in between") << true;
    }

    void stopBeforeTheProjectListKeepsItsDefault()
    {
        QFETCH(bool, pick);
        Fixture f;
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == 1;
        }));
        f.respond(0, FakeTransport::answer(200, meBody(3, 7)));
        const qsizetype projects = f.listRead();
        QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 11)));
        QVERIFY(f.unanswered(projects));
        QVERIFY(f.timer.canWrite());

        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(!f.timer.isRunning());
        if (pick) {
            QVERIFY(f.timer.chooseBillable(true));
        }

        f.respond(projects, FakeTransport::answer(200, projectsBody(7)));
        if (pick) {
            QVERIFY(f.timer.chosenProjectId().isNull());
            QVERIFY(f.timer.chosenBillable());
        } else {
            QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
            QVERIFY(f.timer.chosenBillable());
        }
    }

    void stopOfAnEntryChangedElsewhereIsRefused()
    {
        Fixture f;
        const QByteArray projects = "[" + json(projectObject(11, 7, QStringLiteral("#06aaf5"))) + "," + json(projectObject(12, 7, QStringLiteral("#9e5bd9"))) + "]";
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 7, startedAt, true, 11)));
        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList(projects));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);

        // The stream has not brought the web's move to project 12 yet. The stop is
        // refused against the revision shown; a v9 stop would have stopped it unseen.
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(409, f.nextState(entryBody(5, 7, startedAt, true, 12))));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 12);
        QVERIFY(!f.timer.errorString().isEmpty());

        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("POST", stopPath)).body, revisionBody(f.revision));
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 12);
        QVERIFY(!f.timer.chosenBillable());
        QCOMPARE(f.find("POST", stopPath).size(), 2);
    }

    void reconnectReplacesAnAutomaticDefault_data()
    {
        QTest::addColumn<bool>("pick");
        QTest::newRow("automatic default") << false;
        QTest::newRow("manual pick") << true;
    }

    void reconnectReplacesAnAutomaticDefault()
    {
        QFETCH(bool, pick);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(8, 7, 11, true, true)})));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 11);
        if (pick) {
            QVERIFY(f.timer.chooseProject(QVariant::fromValue(nullptr)));
        }

        const qsizetype before = f.transport.requests.size();
        f.timer.reconnect();
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(read >= before);
        QVERIFY(f.unanswered(read));
        f.respond(read, f.stateAnswer());
        if (pick) {
            QCOMPARE(f.find("GET", listPath).size(), 1);
            QVERIFY(f.timer.chosenProjectId().isNull());
            QVERIFY(!f.timer.chosenBillable());
            return;
        }
        QCOMPARE(f.find("GET", listPath).size(), 2);
        f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(9, 7, 12, true, false), listedEntry(8, 7, 11, true, true)})));
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 12);
        QVERIFY(!f.timer.chosenBillable());
    }

    void stopOfAStoppedEntryAdoptsTheState()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        const qsizetype reads = f.stateReads();
        f.respond(f.last("POST", stopPath), FakeTransport::answer(409, f.nextState("null")));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.errorString().isEmpty());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.stateReads(), reads);
        QCOMPARE(f.find("POST", stopPath).size(), 1);
    }

    void ambiguousStartGoesOutOnceMoreWithItsKey_data()
    {
        QTest::addColumn<bool>("serverStarted");
        QTest::addColumn<int>("failure"); // 0 timeout, 1 network, 2 HTTP 502, 3 unreadable 200
        for (int failure = 0; failure < 4; ++failure) {
            QTest::addRow("started, failure %d", failure) << true << failure;
            QTest::addRow("not started, failure %d", failure) << false << failure;
        }
    }

    // An unknown outcome is sent once more with the same Idempotency-Key, so the
    // server answers what the first did. Still unknown: busy until a read.
    void ambiguousStartGoesOutOnceMoreWithItsKey()
    {
        QFETCH(bool, serverStarted);
        QFETCH(int, failure);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", startPath);
        const HttpRequest first = f.transport.requests.at(post);
        QCOMPARE(first.idempotencyKey.size(), 32);
        const HttpResponse responses[] = {
            FakeTransport::failure(HttpResponse::Outcome::Timeout),
            FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Connection refused")),
            FakeTransport::answer(502, "\"Bad gateway\""),
            FakeTransport::answer(200, "{\"unexpected\":true}"),
        };
        f.respond(post, responses[failure]);
        QVERIFY(f.timer.isBusy());
        QCOMPARE(f.find("POST", startPath).size(), 1);
        QTRY_COMPARE(f.find("POST", startPath).size(), 2);
        const qsizetype again = f.last("POST", startPath);
        QCOMPARE(f.transport.requests.at(again).body, first.body);
        QCOMPARE(f.transport.requests.at(again).idempotencyKey, first.idempotencyKey);
        f.respond(again, responses[failure]);

        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());
        QVERIFY(!f.timer.errorString().isEmpty());
        qsizetype read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));

        f.respond(read, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Network unreachable")));
        QVERIFY(f.timer.isBusy());
        QVERIFY(f.timer.isStale());
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));
        f.respond(read, f.stateAnswer(serverStarted ? entryBody(30, 7, QStringLiteral("2026-10-16T09:00:00Z")) : QByteArray("null")));

        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isStale());
        QCOMPARE(f.timer.isRunning(), serverStarted);
        QCOMPARE(f.timer.canWrite(), true);
        QCOMPARE(f.find("POST", startPath).size(), 2);
    }

    void aLostStartIsAnsweredByItsKey()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", startPath);
        f.respond(post, FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QTRY_VERIFY(f.last("POST", startPath) != post);
        const qsizetype again = f.last("POST", startPath);
        f.respond(again, f.stateAnswer(entryBody(30, 7, clockText(f.clock.now()))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.isRunning());
        QVERIFY(f.timer.errorString().isEmpty());

        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QVERIFY(f.timer.start());
        const QByteArray nextKey = f.transport.requests.at(f.last("POST", startPath)).idempotencyKey;
        QCOMPARE(nextKey.size(), 32);
        QVERIFY(nextKey != f.transport.requests.at(post).idempotencyKey);
    }

    // Stop, pause and resume carry no Idempotency-Key.
    void answeredStartIsNotSentAgain()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), FakeTransport::answer(409, f.nextState(entryBody(30, 7, startedAt))));
        QCOMPARE(f.find("POST", startPath).size(), 1);
        QVERIFY(f.timer.toggle());
        const qsizetype pause = f.last("POST", "/timer/pause");
        QVERIFY(f.transport.requests.at(pause).idempotencyKey.isEmpty());
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(pause).body).object(), QJsonObject({{QStringLiteral("revision"), f.revision}}));
    }

    void lateRepliesCannotOverwriteNewerState()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        poll(f);
        const qsizetype stalePoll = f.last("GET", statePath);
        QVERIFY(f.unanswered(stalePoll));
        const qint64 before = f.revision;
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), f.stateAnswer(entryBody(40, 7, QStringLiteral("2026-10-16T09:01:01Z"))));
        QVERIFY(!f.timer.isBusy());
        QCOMPARE(f.timer.currentEntry()->id, 40);

        // The start's state is newer than the late poll's, so it stays.
        f.respond(stalePoll, FakeTransport::answer(200, stateJson(before, f.clock.now(), "null", QJsonValue::Null, QJsonValue::Null)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.currentEntry()->id, 40);
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find("POST", startPath).size(), 1);

        poll(f);
        QVERIFY(f.answerState());
        QVERIFY(!f.timer.isRunning());
    }

    void transientFailureKeepsStaleDataAndRecovers()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QVERIFY(f.timer.isStale());
        QVERIFY(f.timer.isConnected());
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.connectionState(), Connection::Disconnected);
        QVERIFY(!f.timer.errorString().isEmpty());
        f.clock.advance(1000);
        QCOMPARE(f.timer.elapsedSeconds(), 65 + 31);

        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        const qsizetype catalogReads = f.transport.catalogRequests.size();
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.isStale());
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.errorString().isEmpty());
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads + 1);
        QVERIFY(!f.unanswered(f.last("GET", statePath)));
    }

    void reconnectionRefreshes()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(503, "\"Unavailable\""));
        QCOMPARE(f.timer.connectionState(), Connection::Disconnected);
        const qsizetype reads = f.find("GET", statePath).size();

        f.connection.refreshAccount();
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QCOMPARE(f.find("GET", statePath).size(), reads + 1);
        QVERIFY(f.answerState(entryBody(6, 7, startedAt)));
        QCOMPARE(f.timer.currentEntry()->id, 6);
    }

    void authenticationFailureClears_data()
    {
        QTest::addColumn<int>("status");
        QTest::newRow("401") << 401;
        QTest::newRow("403 on the state") << 403;
    }

    void authenticationFailureClears()
    {
        QFETCH(int, status);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.chooseProject(11));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(status, "\"Incorrect username and/or password\""));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.isStale());
        QVERIFY(!f.timer.canWrite());
        QCOMPARE(f.timer.connectionState(), Connection::AuthenticationFailed);
        QVERIFY(!f.timer.errorString().isEmpty());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));

        const qsizetype requests = f.transport.requests.size();
        for (int i = 0; i < 90; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.transport.requests.size(), requests);
    }

    void unauthorizedWriteClears()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(401, "\"Unauthorized\""));
        QVERIFY(!f.timer.isConnected());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isRunning());
        QCOMPARE(f.find("POST", stopPath).size(), 1);
    }

    void rateLimitCooldown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        for (int i = 0; i < 30; ++i) {
            f.clock.advance(1000);
        }
        f.respond(f.last("GET", statePath), FakeTransport::answer(429, "\"Too many requests\"", "60"));
        QCOMPARE(f.timer.connectionState(), Connection::RateLimited);
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.errorString().isEmpty());

        const qsizetype requests = f.transport.requests.size();
        for (int i = 0; i < 31; ++i) {
            f.clock.advance(1000);
        }
        f.state.resumed();
        QVERIFY(!f.timer.start());
        QCOMPARE(f.transport.requests.size(), requests);

        for (int i = 0; i < 28; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.timer.connectionState(), Connection::RateLimited);
        f.clock.advance(1000);
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(f.unanswered(f.last("GET", statePath)));
        QVERIFY(f.transport.requests.size() > requests);
    }

    void rateLimitedStartIsNotReplayed()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), FakeTransport::answer(429, "\"Too many requests\"", "1"));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        f.clock.advance(1000);
        QCOMPARE(f.timer.connectionState(), Connection::Connected);
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find("POST", startPath).size(), 1);
    }

    void workspaceForbiddenBlocksWrites_data()
    {
        QTest::addColumn<QByteArray>("trigger"); // the request that answers 403
        QTest::newRow("catalog") << QByteArray("catalog");
        QTest::newRow("projects") << QByteArray("projects");
        QTest::newRow("start") << QByteArray("start");
        QTest::newRow("stop") << QByteArray("stop");
    }

    void workspaceForbiddenBlocksWrites()
    {
        QFETCH(QByteArray, trigger);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chosenBillable());
        if (trigger != "start") {
            QVERIFY(f.push(entryBody(5, 7, startedAt)));
        }

        const QByteArray forbidden("\"User does not have access to this resource.\"");
        if (trigger == "catalog") {
            f.transport.holdCatalog = true;
            f.timer.refreshProjects();
            f.transport.respondCatalog(f.transport.catalogRequests.size() - 1, FakeTransport::answer(403, forbidden));
        } else if (trigger == "projects") {
            f.changeCatalog();
            f.timer.refreshProjects();
            QVERIFY(f.answerList(FakeTransport::answer(403, forbidden)));
        } else if (trigger == "start") {
            QVERIFY(f.timer.start());
            f.respond(f.last("POST", startPath), FakeTransport::answer(403, forbidden));
        } else {
            QVERIFY(f.timer.stop());
            f.respond(f.last("POST", stopPath), FakeTransport::answer(403, forbidden));
        }

        QVERIFY(f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isConnected());
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.errorString().contains(QStringLiteral("User does not have access to this resource.")));
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());

        QCOMPARE(f.find("GET", "/me").size(), 2);
        const qsizetype rediscovery = f.last("GET", "/me");
        QVERIFY(f.unanswered(rediscovery));
        f.respond(rediscovery, FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.timer.workspaceAccessLost());

        const qsizetype requests = f.otherRequests();
        const qsizetype catalogReads = f.transport.catalogRequests.size();
        for (int i = 0; i < 95; ++i) {
            f.clock.advance(1000);
        }
        f.state.resumed();
        f.timer.refreshProjects();
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.stop());
        QCOMPARE(f.otherRequests(), requests);
        QCOMPARE(f.transport.catalogRequests.size(), catalogReads);
        QCOMPARE(f.find("POST", startPath).size(), trigger == "start" ? 1 : 0);
        QCOMPARE(f.find("POST", stopPath).size(), trigger == "stop" ? 1 : 0);

        f.transport.holdCatalog = false;
        f.timer.reconnect();
        QVERIFY(!f.timer.workspaceAccessLost());
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        if (f.unanswered(f.last("GET", statePath))) {
            QVERIFY(f.answerState("null"));
        }
        QVERIFY(f.answerList(projectsBody(7)));
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.projects().size(), 1);
    }

    void workspaceLossKeepsTheMutationLock()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        f.transport.holdCatalog = true;
        f.timer.refreshProjects();
        QVERIFY(f.timer.start());
        const qsizetype post = f.last("POST", startPath);

        f.transport.respondCatalog(f.transport.catalogRequests.size() - 1, FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        f.transport.holdCatalog = false;
        QVERIFY(f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isBusy());
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));

        f.timer.reconnect();
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.answerList(projectsBody(7)));
        QVERIFY(!f.timer.workspaceAccessLost());
        QVERIFY(f.timer.isBusy());
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.start());
        QVERIFY(!f.timer.toggle());
        QCOMPARE(f.find("POST", startPath).size(), 1);
        if (f.unanswered(f.last("GET", statePath))) {
            f.respond(f.last("GET", statePath), FakeTransport::answer(200, stateJson(f.revision, f.clock.now(), "null", QJsonValue::Null, QJsonValue::Null)));
        }

        const qsizetype readsBefore = f.find("GET", statePath).size();
        f.respond(post, f.stateAnswer(entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
        QCOMPARE(f.find("GET", statePath).size(), readsBefore + 1);
        const qsizetype read = f.last("GET", statePath);
        QVERIFY(f.unanswered(read));
        QVERIFY(!f.timer.canWrite());
        QVERIFY(!f.timer.toggle());
        f.respond(read, f.stateAnswer(entryBody(40, 7, QStringLiteral("2026-10-16T09:00:00Z"))));
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.timer.currentEntry()->id, 40);
        QCOMPARE(f.find("POST", startPath).size(), 1);
    }

    void workspaceRediscoveryMovesToTheNewWorkspace()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        QVERIFY(f.timer.workspaceAccessLost());

        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 8)));
        QVERIFY(!f.timer.workspaceAccessLost());
        QCOMPARE(f.timer.workspaceId(), 8);
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        const qsizetype projects = f.listRead();
        QVERIFY(projects >= 0);
        QCOMPARE(f.transport.catalogRequests.last().url.path(), QStringLiteral("/api/app/workspaces/8/catalog"));
        QCOMPARE(f.transport.requests.at(projects).url.path(), QStringLiteral("/api/v9/workspaces/8/projects"));
        f.respond(projects, FakeTransport::answer(200, projectsBody(8)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.canWrite());
        QCOMPARE(f.find("POST", stopPath).size(), 1);
    }

    void rediscoveryRefusedClearsTheAccount()
    {
        Fixture f;
        QVERIFY(connectAccount(f));
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), FakeTransport::answer(403, "\"User does not have access to this resource.\""));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(403, "\"Incorrect username and/or password\""));
        QVERIFY(!f.timer.isConnected());
        QCOMPARE(f.timer.connectionState(), Connection::AuthenticationFailed);
        QVERIFY(!f.timer.canWrite());
        QCOMPARE(f.find("GET", "/me").size(), 2);
    }

    void accountSwitchWithCollidingIds_data()
    {
        QTest::addColumn<bool>("switchInstance");
        QTest::newRow("instance") << true;
        QTest::newRow("account on the same instance") << false;
    }

    void accountSwitchWithCollidingIds()
    {
        QFETCH(bool, switchInstance);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.chosenBillable());
        QVERIFY(f.push(entryBody(5, 7, startedAt)));
        QVERIFY(f.timer.stop());
        const qsizetype oldStop = f.last("POST", stopPath);
        QVERIFY(f.timer.isBusy());

        QSignalSpy entryChanged(&f.timer, &TimerController::currentEntryChanged);
        if (switchInstance) {
            f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
            f.connection.setInstanceUrl(instanceB);
        } else {
            f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), QStringLiteral("tok-other"));
            Q_EMIT f.store.secretChanged(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()));
        }
        QVERIFY(entryChanged.count() > 0);
        QVERIFY(!f.timer.isRunning());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(!f.timer.isConnected());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("0:00"));

        // The new account reuses user 3, workspace 7 and entry 5.
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        const qsizetype newRead = f.last("GET", statePath);
        QVERIFY(f.unanswered(newRead));
        QVERIFY(f.transport.requests.at(newRead).url.host() == (switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test")));

        f.respond(oldStop, FakeTransport::answer(200, stateJson(f.revision + 10, f.clock.now(), "null", QJsonValue::Null, QJsonValue::Null)));
        f.respond(newRead, f.stateAnswer(entryBody(5, 7, QStringLiteral("2026-10-16T08:00:00Z"))));
        QVERIFY(f.answerList(projectsBody(7)));
        QVERIFY(f.timer.isRunning());
        QCOMPARE(f.timer.elapsedText(), QStringLiteral("1:00"));
        QVERIFY(f.timer.chosenProjectId().isNull());
        QVERIFY(!f.timer.chosenBillable());
        QVERIFY(!f.timer.isBusy());
        QVERIFY(f.timer.canWrite());

        QVERIFY(f.timer.stop());
        QCOMPARE(f.transport.requests.at(f.last("POST", stopPath)).url.host(),
                 switchInstance ? QStringLiteral("b.example.test") : QStringLiteral("a.example.test"));
    }

    void indicatorFollowsTheRunningEntry()
    {
        Fixture f;
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);

        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.transport.requests.size() == 1;
        }));
        f.respond(0, FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 11)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 1);
        QVERIFY(f.answerList(projectsBody(7)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#06aaf5"));
        QCOMPARE(indicator.count(), 2);

        poll(f);
        QVERIFY(f.answerState(entryBody(5, 7, startedAt)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 3);
    }

    void indicatorResolvesProjectsMissingFromTheList_data()
    {
        QTest::addColumn<bool>("running");
        QTest::newRow("running entry") << true;
        QTest::newRow("next start") << false;
    }

    // A list cut short can miss an active project.
    void indicatorResolvesProjectsMissingFromTheList()
    {
        QFETCH(bool, running);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, running ? entryBody(5, 7, startedAt, true, 33) : QByteArray("null")));
        if (!running) {
            f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(8, 7, 33, true)})));
        }
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 33);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        QCOMPARE(f.timer.chosenProjectLabel(), ProjectLabelParts::unknown());
        const qsizetype archived = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(archived));

        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);
        f.respond(archived, FakeTransport::answer(200, json(projectObject(33, 7, QStringLiteral("#9E5BD9"), false))));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#9e5bd9"));
        QCOMPARE(indicator.count(), 1);
        QCOMPARE(f.timer.chosenProjectLabel().kind, running ? ProjectLabelParts::Kind::Named : ProjectLabelParts::Kind::Unknown);
        QCOMPARE(f.timer.chosenProjectLabel().archived, running);

        if (running) {
            poll(f);
            QVERIFY(f.answerState(entryBody(5, 7, startedAt, true, 44)));
        } else {
            f.timer.reconnect();
            f.respond(f.last("GET", statePath), f.stateAnswer());
            f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(9, 7, 44, true)})));
        }
        QCOMPARE(f.timer.chosenProjectId().toLongLong(), 44);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Pending);
        f.respond(f.last("GET", "/projects/44"), FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 3);
        QCOMPARE(f.timer.chosenProjectLabel().kind, running ? ProjectLabelParts::Kind::Unavailable : ProjectLabelParts::Kind::Unknown);
        QCOMPARE(f.find("GET", "/projects/44").size(), 1);
    }

    void lookedUpProjectIsReadAgainOnRefresh_data()
    {
        QTest::addColumn<bool>("running");
        QTest::addColumn<bool>("viaReconnect");
        QTest::newRow("running entry, reconnect") << true << true;
        QTest::newRow("running entry, projects reload") << true << false;
        QTest::newRow("next start, reconnect") << false << true;
        QTest::newRow("next start, projects reload") << false << false;
    }

    void lookedUpProjectIsReadAgainOnRefresh()
    {
        QFETCH(bool, running);
        QFETCH(bool, viaReconnect);
        const QByteArray current = running ? entryBody(5, 7, startedAt, true, 33) : QByteArray("null");
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        if (!running) {
            f.respond(f.last("GET", listPath), FakeTransport::answer(200, listBody({listedEntry(8, 7, 33, true)})));
        }
        f.respond(f.last("GET", "/projects/33"), FakeTransport::answer(200, json(projectObject(33, 7, QStringLiteral("#9e5bd9"), false))));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(f.find("GET", "/projects/33").size(), 1);

        const qsizetype before = f.transport.requests.size();
        f.changeCatalog();
        if (viaReconnect) {
            f.timer.reconnect();
            const qsizetype read = f.last("GET", statePath);
            QVERIFY(read >= before);
            f.respond(read, f.stateAnswer(current));
        } else {
            f.timer.refreshProjects();
        }
        const qsizetype list = f.listRead();
        QVERIFY(list >= before);
        f.respond(list, FakeTransport::answer(200, projectsBody(7)));
        QCOMPARE(f.find("GET", "/projects/33").size(), 2);
        const qsizetype again = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(again));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);

        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList(projectsBody(7)));
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), 2);

        // That read began before the second reload, so its answer is checked again.
        f.respond(again, FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(f.find("GET", "/projects/33").size(), 3);
        f.respond(f.last("GET", "/projects/33"), FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), 3);
    }

    void lookupFromBeforeAReloadIsReadAgain_data()
    {
        QTest::addColumn<bool>("cached");
        QTest::newRow("revalidation") << true;
        QTest::newRow("first read") << false;
    }

    void lookupFromBeforeAReloadIsReadAgain()
    {
        QFETCH(bool, cached);
        const QByteArray current = entryBody(5, 7, startedAt, true, 33);
        const QByteArray archived = json(projectObject(33, 7, QStringLiteral("#9e5bd9"), false));
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        qsizetype older = f.last("GET", "/projects/33");
        if (cached) {
            f.respond(older, FakeTransport::answer(200, archived));
            f.changeCatalog();
            f.timer.refreshProjects();
            QVERIFY(f.answerList(projectsBody(7)));
            older = f.last("GET", "/projects/33");
        }
        QVERIFY(f.unanswered(older));
        const qsizetype reads = f.find("GET", "/projects/33").size();

        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList(projectsBody(7)));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads);
        f.respond(older, FakeTransport::answer(200, archived));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);

        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
        const qsizetype followUp = f.last("GET", "/projects/33");
        QVERIFY(f.unanswered(followUp));
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
        f.respond(followUp, FakeTransport::answer(404, "\"Project not found\""));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        poll(f);
        QVERIFY(f.answerState(current));
        QCOMPARE(f.find("GET", "/projects/33").size(), reads + 1);
    }

    void indicatorColorMustBeHex_data()
    {
        QTest::addColumn<QString>("color");
        QTest::newRow("empty") << QString();
        QTest::newRow("short") << QStringLiteral("#abc");
        QTest::newRow("long") << QStringLiteral("#06aaf5ff");
        QTest::newRow("no hash") << QStringLiteral("06aaf5");
        QTest::newRow("name") << QStringLiteral("red");
        QTest::newRow("not hex") << QStringLiteral("#06aaf g");
        QTest::newRow("trailing space") << QStringLiteral("#06aaf5 ");
    }

    void indicatorColorMustBeHex()
    {
        QFETCH(QString, color);
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList("[" + json(projectObject(12, 7, color)) + "]"));
        QVERIFY(f.timer.chooseProject(12));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QVERIFY(f.timer.indicatorColor().isEmpty());
    }

    void indicatorChangesAreSignalled()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QSignalSpy indicator(&f.timer, &TimerController::indicatorChanged);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);

        QVERIFY(f.timer.chooseProject(11));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(indicator.count(), 1);

        QVERIFY(f.timer.start());
        f.respond(f.last("POST", startPath), f.stateAnswer(entryBody(21, 7, startedAt)));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QCOMPARE(indicator.count(), 2);

        poll(f);
        QVERIFY(f.answerState(entryBody(22, 7, startedAt, true, 11)));
        QCOMPARE(indicator.count(), 3);
        QVERIFY(f.timer.stop());
        f.respond(f.last("POST", stopPath), f.stateAnswer("null"));
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::Project);
        QCOMPARE(indicator.count(), 3);

        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList("[" + json(projectObject(11, 7, QStringLiteral("#d92b2b"))) + "]"));
        QCOMPARE(f.timer.indicatorColor(), QStringLiteral("#d92b2b"));
        QCOMPARE(indicator.count(), 4);

        f.connection.setInstanceUrl(instanceB);
        QCOMPARE(f.timer.indicatorState(), TimerController::IndicatorState::None);
        QVERIFY(f.timer.indicatorColor().isEmpty());
        QCOMPARE(indicator.count(), 5);
    }

    void incompleteProjectListFollowsTheConnection()
    {
        Fixture f;
        QVERIFY(f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString()), token) != f.store.secrets.end());
        f.connection.setInstanceUrl(instanceA);
        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(3, 7)));
        QVERIFY(f.answerState("null"));
        QVERIFY(!f.timer.projectsIncomplete());

        QSignalSpy changed(&f.timer, &TimerController::projectsChanged);
        for (int page = 1; page <= Connection::maxProjectPages; ++page) {
            const qsizetype request = f.listRead();
            QVERIFY(f.unanswered(request));
            QCOMPARE(f.timer.projects().size(), 0);
            f.respond(request, FakeTransport::answer(200, projectPage((page - 1) * Connection::projectPageSize + 1, Connection::projectPageSize, 7)));
        }
        QVERIFY(f.timer.projectsIncomplete());
        QCOMPARE(f.timer.projects().size(), Connection::maxProjectPages * Connection::projectPageSize);
        QCOMPARE(changed.count(), 1);

        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceB), AuthMode::Token, QString()), token);
        f.connection.setInstanceUrl(instanceB);
        QVERIFY(!f.timer.projectsIncomplete());
        QVERIFY(f.timer.projects().isEmpty());
        QVERIFY(changed.count() > 1);

        QVERIFY(QTest::qWaitFor([&] {
            return f.unanswered(f.last("GET", "/me"));
        }));
        f.respond(f.last("GET", "/me"), FakeTransport::answer(200, meBody(4, 7)));
        QVERIFY(f.answerState("null"));
        QVERIFY(f.answerList(projectPage(1, Connection::projectPageSize, 7)));
        QVERIFY(f.answerList(projectPage(1000, 3, 7)));
        QCOMPARE(f.timer.projects().size(), Connection::projectPageSize + 3);
        QVERIFY(!f.timer.projectsIncomplete());
    }

    void entryFromAnotherWorkspaceIsNotShown()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, entryBody(5, 99, startedAt)));
        QVERIFY(!f.timer.isRunning());
        QVERIFY(f.timer.currentEntryVariant().isNull());
    }

    // Rows follow the projects, not the choice, so an open menu keeps its items.
    void projectChoicesFollowTheProjects()
    {
        Fixture f;
        QVERIFY(connectAccount(f, instanceA, 3, 7, "null"));
        QSignalSpy changed(&f.timer, &TimerController::projectChoicesChanged);
        QCOMPARE(f.timer.projectChoicesVariant().size(), 1);
        QVERIFY(f.timer.projectChoices().choosable);
        QVERIFY(f.timer.projectChoices().noProjectChecked);

        QVERIFY(f.timer.chooseProject(11));
        QVERIFY(f.timer.projectChoices().rows.at(0).checked);
        QVERIFY(!f.timer.projectChoices().noProjectChecked);
        QCOMPARE(changed.count(), 0);

        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList("[" + json(projectObject(11, 7, QStringLiteral("#06aaf5"))) + "," + json(projectObject(12, 7, QStringLiteral("#9e5bd9"))) + "]"));
        QCOMPARE(changed.count(), 1);
        QCOMPARE(f.timer.projectChoicesVariant().size(), 2);
    }

    static QStringList listed(const Fixture &f)
    {
        QStringList projects;
        for (const QVariant &project : f.timer.projects()) {
            const QVariantMap map = project.toMap();
            projects.append(QStringLiteral("%1 %2 %3 %4")
                                .arg(map.value(QStringLiteral("id")).toLongLong())
                                .arg(map.value(QStringLiteral("name")).toString(),
                                     map.value(QStringLiteral("clientName")).toString(),
                                     map.value(QStringLiteral("color")).toString()));
        }
        return projects;
    }

    void openingTheMenuChecksTheProjectsOnly()
    {
        Fixture f;
        const QByteArray current = entryBody(5, 7, startedAt);
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        const qsizetype stateReads = f.stateReads();
        const qsizetype others = f.otherRequests();
        const qsizetype checks = f.transport.catalogRequests.size();

        f.timer.refreshProjects();
        QTRY_COMPARE(f.transport.catalogRequests.size(), checks + 1);
        QTest::qWait(20);
        QCOMPARE(f.otherRequests(), others);

        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList("[" + json(projectObject(12, 7, QStringLiteral("#112233"))) + "]"));
        QCOMPARE(f.transport.catalogRequests.size(), checks + 2);
        QCOMPARE(f.otherRequests(), others + 1);
        QCOMPARE(f.timer.projects().size(), 1);
        QCOMPARE(f.timer.projects().constFirst().toMap().value(QStringLiteral("id")).toLongLong(), 12);

        f.transport.holdCatalog = true;
        f.timer.refreshProjects();
        f.timer.refreshProjects();
        f.timer.refreshProjects();
        QCOMPARE(f.transport.catalogRequests.size(), checks + 3);
        f.transport.respondCatalog(checks + 2, FakeTransport::catalogAt(f.catalogRevision));
        QTest::qWait(20);
        QCOMPARE(f.otherRequests(), others + 1);
        QCOMPARE(f.stateReads(), stateReads);
    }

    void refreshReadsTheListWhenTheCatalogChanged()
    {
        Fixture f;
        const QByteArray current = entryBody(5, 7, startedAt);
        auto alpha = [](const QString &client) {
            QJsonObject project = projectObject(11, 7, QStringLiteral("#06aaf5"));
            project.insert(QStringLiteral("client_id"), 4);
            project.insert(QStringLiteral("client_name"), client);
            return json(project);
        };
        const QByteArray projects = "[" + alpha(QStringLiteral("Acme")) + "," + json(projectObject(12, 7, QStringLiteral("#112233"))) + "]";
        QVERIFY(connectAccount(f, instanceA, 3, 7, current, QJsonValue::Null, QJsonValue::Null, projects));
        QCOMPARE(listed(f), (QStringList{QStringLiteral("11 P11 Acme #06aaf5"), QStringLiteral("12 P12  #112233")}));
        const qsizetype lists = f.find("GET", "/projects").size();

        QSignalSpy changed(&f.timer, &TimerController::projectsChanged);
        f.timer.refreshProjects();
        QTest::qWait(20);
        f.state.resumed();
        QVERIFY(f.answerState(current));
        QTest::qWait(20);
        QCOMPARE(f.transport.catalogRequests.size(), 3);
        QCOMPARE(f.find("GET", "/projects").size(), lists);
        QCOMPARE(changed.count(), 0);

        // A client rename or project deletion moves only the catalog revision.
        f.changeCatalog();
        f.timer.refreshProjects();
        const qsizetype read = f.listRead();
        QVERIFY(read >= 0);
        QCOMPARE(f.transport.requests.at(read).url.query(), QStringLiteral("active=true&page=1&per_page=200"));
        f.respond(read, FakeTransport::answer(200, "[" + alpha(QStringLiteral("Acme Renamed")) + "]"));
        QCOMPARE(listed(f), QStringList{QStringLiteral("11 P11 Acme Renamed #06aaf5")});
        QCOMPARE(changed.count(), 1);

        f.timer.refreshProjects();
        QTest::qWait(20);
        QCOMPARE(f.transport.catalogRequests.size(), 5);
        QCOMPARE(f.find("GET", "/projects").size(), lists + 1);
    }

    // The revision kept is the one read before the list, so a write landing
    // mid-read shows on the next refresh.
    void writeDuringAListReadIsReadNextTime()
    {
        Fixture f;
        const QByteArray current = entryBody(5, 7, startedAt);
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        f.transport.holdCatalog = true;
        f.timer.refreshProjects();
        QCOMPARE(f.transport.catalogRequests.size(), 2);
        f.timer.refreshProjects();
        QCOMPARE(f.transport.catalogRequests.size(), 2);
        f.transport.respondCatalog(1, FakeTransport::catalogAt(2));
        const qsizetype read = f.listRead();
        QVERIFY(read >= 0);
        f.timer.refreshProjects();
        QCOMPARE(f.transport.catalogRequests.size(), 2);

        f.respond(read, FakeTransport::answer(200, projectsBody(7)));
        f.timer.refreshProjects();
        QCOMPARE(f.transport.catalogRequests.size(), 3);
        f.transport.respondCatalog(2, FakeTransport::catalogAt(3));
        QVERIFY(f.answerList("[" + json(projectObject(12, 7, QStringLiteral("#112233"))) + "]"));
        QCOMPARE(listed(f), QStringList{QStringLiteral("12 P12  #112233")});

        f.timer.refreshProjects();
        f.transport.respondCatalog(3, FakeTransport::catalogAt(3));
        QCOMPARE(f.find("GET", "/projects").size(), 3);
    }

    void failedListReadIsReadAgain()
    {
        Fixture f;
        const QByteArray current = entryBody(5, 7, startedAt);
        QVERIFY(connectAccount(f, instanceA, 3, 7, current));
        f.changeCatalog();
        f.timer.refreshProjects();
        QVERIFY(f.answerList(FakeTransport::answer(503, "\"Unavailable\"")));
        QCOMPARE(listed(f), QStringList{QStringLiteral("11 Alpha  #06aaf5")});

        f.timer.refreshProjects();
        QVERIFY(f.answerList(projectsBody(7)));
        QCOMPARE(f.find("GET", "/projects").size(), 3);
    }
};

QTEST_GUILESS_MAIN(TimerControllerTest)
#include "timercontrollertest.moc"
