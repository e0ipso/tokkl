// The menu bar app without its platform layer: the item's text, image and click,
// the menu, the settings window and the client name, driven through the
// core's fake transport, store and clock, a fake menu bar item and a fake
// login item.

#include "alarmplayer.h"
#include "connection.h"
#include "connectionsetup.h"
#include "fakes.h"
#include "instanceurl.h"
#include "loginitem.h"
#include "menubarapp.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "settingswindow.h"
#include "statusimage.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QCheckBox>
#include <QComboBox>
#include <QFile>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QPointer>
#include <QPushButton>
#include <QRadioButton>
#include <QSettings>
#include <QSignalSpy>
#include <QSpinBox>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTest>

#include <memory>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://a.example.test");
const QString token = QStringLiteral("tok-macos-1");
const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z"); // 65 s before the fake clock

class FakeStatusItem : public StatusItem
{
    Q_OBJECT

public:
    using StatusItem::StatusItem;

    void setTitle(const QString &text) override
    {
        title = text;
    }
    void setToolTip(const QString &text) override
    {
        toolTip = text;
    }
    void setAccessibleName(const QString &text) override
    {
        accessibleName = text;
    }
    void setMenu(QMenu *value) override
    {
        menu = value;
    }
    void setImage(const StatusImage &value) override
    {
        image = value;
        indicator = value.indicator;
    }
    bool reduceMotion() const override
    {
        return reduce;
    }
    void popUpMenu() override
    {
        ++menuPopUps;
    }

    // A primary click.
    void click()
    {
        Q_EMIT activated();
    }

    // Reduce Motion turned on or off in the system settings.
    void setReduceMotion(bool on)
    {
        reduce = on;
        Q_EMIT reduceMotionChanged();
    }

    QString title;
    QString toolTip;
    QString accessibleName;
    QMenu *menu = nullptr;
    StatusImage image;
    // The indicator in the image.
    ProjectIndicator indicator;
    bool reduce = false;
    // How often the app opened the menu itself.
    int menuPopUps = 0;
};

// The core's fake store, with writes that can wait until the test finishes
// them, as a Keychain write waits while macOS asks the user for access.
class HeldCredentialStore : public FakeCredentialStore
{
public:
    using FakeCredentialStore::FakeCredentialStore;

    void write(const QString &key, const QString &secret, QObject *context, Callback done) override
    {
        if (!hold) {
            FakeCredentialStore::write(key, secret, context, done);
            return;
        }
        held.append(Held{key, secret, context, done});
    }

    // Finishes the oldest held write with the status; its callback runs
    // later, from the event loop.
    void finish(CredentialResult::Status status)
    {
        const Held write = held.takeFirst();
        if (!write.context) {
            return;
        }
        const CredentialResult::Status previous = failure;
        failure = status;
        FakeCredentialStore::write(write.key, write.secret, write.context, write.done);
        failure = previous;
    }

    struct Held {
        QString key;
        QString secret;
        QPointer<QObject> context;
        Callback done;
    };

    bool hold = false;
    QList<Held> held;
};

class FakeLoginItem : public LoginItem
{
public:
    State state() const override
    {
        return current;
    }
    QString setEnabled(bool enabled) override
    {
        calls.append(enabled);
        if (!failure.isEmpty()) {
            return failure;
        }
        current = enabled ? State::Enabled : State::Disabled;
        return QString();
    }

    State current = State::Disabled;
    QString failure;
    QList<bool> calls;
};

// Records what the app asked it to play.
class FakeAlarmPlayer : public AlarmPlayer
{
    Q_OBJECT

public:
    using AlarmPlayer::AlarmPlayer;

    void loop(const QString &file) override
    {
        looping = file;
        loops.append(file);
    }
    void stop() override
    {
        looping.clear();
        ++stops;
    }
    void preview(const QString &file) override
    {
        previews.append(file);
    }

    // The file that loops now; empty after stop().
    QString looping;
    QStringList loops;
    QStringList previews;
    int stops = 0;
};

// The four WAVs the bundle ships, from the core's sounds directory.
QString soundFile(const QString &id)
{
    return QStringLiteral(TOKKL_SOUNDS_DIR "/pomodoro-") + id + QStringLiteral(".wav");
}

QByteArray meBody()
{
    return QByteArrayLiteral(
        R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})");
}

// The running entry that started at startedAt.
QByteArray entryBody(std::optional<qint64> project = std::nullopt, bool billable = false)
{
    const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), 5},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("billable"), billable},
                             {QStringLiteral("start"), startedAt},
                             {QStringLiteral("stop"), QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("duration"), -begin.toSecsSinceEpoch()},
                             {QStringLiteral("description"), QString()},
                         })
        .toJson(QJsonDocument::Compact);
}

// The entry of entryBody, stopped after a minute: the server's answer to a
// stop.
QByteArray stoppedEntryBody(std::optional<qint64> project = std::nullopt)
{
    const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), 5},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("billable"), false},
                             {QStringLiteral("start"), startedAt},
                             {QStringLiteral("stop"), begin.addSecs(60).toString(Qt::ISODate)},
                             {QStringLiteral("duration"), 60},
                             {QStringLiteral("description"), QString()},
                         })
        .toJson(QJsonDocument::Compact);
}

// A running entry with everything a resume copies: description, project,
// task, tags and billable flag.
QByteArray chainEntryBody(qint64 id, const QDateTime &begin)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), 11},
                             {QStringLiteral("task_id"), 21},
                             {QStringLiteral("billable"), true},
                             {QStringLiteral("start"), begin.toString(Qt::ISODate)},
                             {QStringLiteral("stop"), QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("duration"), -begin.toSecsSinceEpoch()},
                             {QStringLiteral("description"), QStringLiteral("Write the report")},
                             {QStringLiteral("tags"), QJsonArray{QStringLiteral("deep"), QStringLiteral("review")}},
                         })
        .toJson(QJsonDocument::Compact);
}

QByteArray projectsBody()
{
    return QByteArrayLiteral(
        R"([{"id":11,"workspace_id":7,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true},)"
        R"({"id":12,"workspace_id":7,"client_id":4,"client_name":"Acme","name":"Beta","color":"#c7af14","active":true,"billable":false}])");
}

// GET /me/time_entries?meta=true with one stopped entry on the project.
QByteArray recentBody(qint64 project)
{
    return QStringLiteral(
               R"([{"id":4,"workspace_id":7,"project_id":%1,"billable":false,"start":"2026-10-15T08:00:00Z","stop":"2026-10-15T08:01:00Z",)"
               R"("duration":60,"description":"","tags":[],"project_active":true,"project_billable":false}])")
        .arg(project)
        .toUtf8();
}

// GET /me/preferences: phases of one minute and a long rest after every
// second work phase.
QByteArray preferencesBody()
{
    return QByteArrayLiteral(
        R"({"pomodoro_focus_interval_in_minutes":1,"pomodoro_break_interval_in_minutes":1,)"
        R"("pomodoro_long_break_interval_in_minutes":1,"pomodoro_long_break_every":2})");
}

QJsonObject jsonBody(const HttpRequest &request)
{
    return QJsonDocument::fromJson(request.body).object();
}

QString iso(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODateWithMs);
}

// The server's pause chain of the chainEntryBody entry, with the seconds its
// stopped entries stored, and the running clone unless paused.
QJsonObject pauseObject(bool paused, qint64 seconds, std::optional<qint64> clone = std::nullopt)
{
    return QJsonObject{
        {QStringLiteral("paused"), paused},
        {QStringLiteral("seconds"), seconds},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("description"), QStringLiteral("Write the report")},
        {QStringLiteral("project_id"), 11},
        {QStringLiteral("task_id"), 21},
        {QStringLiteral("tag_ids"), QJsonArray{3, 5}},
        {QStringLiteral("tags"), QJsonArray{QStringLiteral("deep"), QStringLiteral("review")}},
        {QStringLiteral("billable"), true},
        {QStringLiteral("clone_entry_id"), clone ? QJsonValue(*clone) : QJsonValue(QJsonValue::Null)},
    };
}

// The phase of a session on the server's clock, with what the server derives
// from it. Lengths are one minute, with a long rest after every second work
// phase, as preferencesBody says.
struct Phase {
    QString kind;
    QDateTime start;
    int completed = 0;
    QString upcoming;
    QString transition;
    int number = 1;
    QDateTime pomodoroStart;
};

Phase work(const QDateTime &start, int completed = 0)
{
    const bool last = completed + 1 >= 2;
    return Phase{QStringLiteral("work"),
                 start,
                 completed,
                 last ? QStringLiteral("longRest") : QStringLiteral("shortRest"),
                 last ? QStringLiteral("workToLongRest") : QStringLiteral("workToShortRest"),
                 completed + 1,
                 start};
}

Phase shortRest(const QDateTime &start, const QDateTime &pomodoroStart)
{
    return Phase{QStringLiteral("shortRest"), start, 1, QStringLiteral("work"), QStringLiteral("shortRestToWork"), 1, pomodoroStart};
}

QJsonObject pomodoroJson(const Phase &phase, qint64 entryId)
{
    return QJsonObject{
        {QStringLiteral("work_minutes"), 1},
        {QStringLiteral("short_rest_minutes"), 1},
        {QStringLiteral("long_rest_minutes"), 1},
        {QStringLiteral("long_rest_every"), 2},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), phase.kind},
             {QStringLiteral("start"), iso(phase.start)},
             {QStringLiteral("completed"), phase.completed},
             {QStringLiteral("planned_end"), iso(phase.start.addSecs(60))},
         }},
        {QStringLiteral("upcoming_phase"), phase.upcoming},
        {QStringLiteral("transition"), phase.transition},
        {QStringLiteral("number"), phase.number},
        {QStringLiteral("entry_id"), entryId},
        {QStringLiteral("pomodoro_start"), iso(phase.pomodoroStart.isValid() ? phase.pomodoroStart : phase.start)},
    };
}

// A pomodoro the server dropped as too short to keep.
QJsonObject discardedJson(const QDateTime &start)
{
    return QJsonObject{{QStringLiteral("entry_id"), 41}, {QStringLiteral("start"), iso(start)}, {QStringLiteral("stop"), iso(start)}};
}

QByteArray revisionBody(qint64 revision)
{
    return "{\"revision\":" + QByteArray::number(revision) + "}";
}

// The images match the resource files at 1x and 2x, each 16 points square.
void compareWithResources(const QList<QImage> &images, const QStringList &files)
{
    QCOMPARE(images.size(), files.size());
    for (qsizetype i = 0; i < files.size(); ++i) {
        QImage source(QStringLiteral(TOKKL_RESOURCES_DIR "/") + files.at(i));
        QVERIFY2(!source.isNull(), qPrintable(files.at(i)));
        source.setDevicePixelRatio(double(i + 1));
        QCOMPARE(images.at(i), source);
        QCOMPARE(images.at(i).deviceIndependentSize(), QSizeF(16, 16));
    }
}

QAction *projectAction(StatusMenu &menu, const QString &label)
{
    const QList<QAction *> actions = menu.projectMenu()->actions();
    for (QAction *action : actions) {
        if (action->text() == label) {
            return action;
        }
    }
    return nullptr;
}
}

class MenuBarAppTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        // The settings live in settingsFile, or in a file of the fixture's
        // own when it is empty.
        explicit Fixture(const QString &settingsFile = QString())
            : settings(settingsFile.isEmpty() ? dir.filePath(QStringLiteral("tokkl.ini")) : settingsFile, QSettings::IniFormat)
        {
            // The sounds the bundle would hold in Contents/Resources/sounds.
            app.pomodoroAlarm()->setSoundsDirectory(QStringLiteral(TOKKL_SOUNDS_DIR));
        }

        QTemporaryDir dir;
        QSettings settings;
        FakeTransport transport;
        HeldCredentialStore store;
        FakeClock clock;
        FakeStatusItem item;
        FakeLoginItem login;
        FakeAlarmPlayer player;
        MenuBarApp app{&transport, &store, &item, &login, &player, &settings, &clock};

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

        bool waitFor(const QByteArray &method, const QByteArray &suffix, qsizetype after = -1) const
        {
            return QTest::qWaitFor([&] {
                return last(method, suffix) > after;
            });
        }

        void respond(qsizetype index, int status, const QByteArray &body)
        {
            transport.respond(index, FakeTransport::answer(status, body));
        }

        // The timer state at the next revision, built now: the running entry
        // as JSON ("null" for none), the pause chain, the session and a
        // pomodoro the change discarded. server_time is the fake clock's.
        QByteArray state(const QByteArray &running = "null",
                         const QJsonValue &pause = QJsonValue::Null,
                         const QJsonValue &pomodoro = QJsonValue::Null,
                         const QJsonValue &discarded = QJsonValue::Null)
        {
            return QJsonDocument(QJsonObject{
                                     {QStringLiteral("revision"), ++revision},
                                     {QStringLiteral("server_time"), iso(clock.now())},
                                     {QStringLiteral("running_entry"), QJsonDocument::fromJson("[" + running + "]").array().first()},
                                     {QStringLiteral("pause"), pause},
                                     {QStringLiteral("pomodoro"), pomodoro},
                                     {QStringLiteral("discarded_pomodoro"), discarded},
                                 })
                .toJson(QJsonDocument::Compact);
        }

        // The state with a session in the phase. Its open pomodoro is the
        // running entry.
        QByteArray sessionState(const Phase &phase, const QJsonValue &discarded = QJsonValue::Null)
        {
            const QDateTime pomodoroStart = phase.pomodoroStart.isValid() ? phase.pomodoroStart : phase.start;
            return state(chainEntryBody(41, pomodoroStart), QJsonValue::Null, pomodoroJson(phase, 41), discarded);
        }

        // A state from the event stream, as another device's change sends it.
        bool push(const QByteArray &body)
        {
            FakeStream *stream = transport.lastStream();
            if (!stream) {
                return false;
            }
            stream->push("event: timer\ndata: " + body + "\n\n");
            return true;
        }

        // Saved settings for token sign-in, the token in the store, then the
        // answers to /me, the timer state, the projects and the Pomodoro
        // lengths. running is the running entry as JSON, "null" for none.
        bool connect(const QByteArray &running,
                     std::optional<qint64> recentProject = std::nullopt,
                     const QJsonValue &pause = QJsonValue::Null,
                     const QJsonValue &pomodoro = QJsonValue::Null)
        {
            store.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), token);
            settings.setValue(SettingsWindow::instanceUrlKey, instance);
            settings.setValue(SettingsWindow::authModeKey, QStringLiteral("token"));
            app.start();
            if (!waitFor("GET", "/me")) {
                return false;
            }
            respond(last("GET", "/me"), 200, meBody());
            if (!waitFor("GET", "/app/timer") || !waitFor("GET", "/projects") || !waitFor("GET", "/me/preferences")) {
                return false;
            }
            respond(last("GET", "/app/timer"), 200, state(running, pause, pomodoro));
            respond(last("GET", "/projects"), 200, projectsBody());
            respond(last("GET", "/me/preferences"), 200, preferencesBody());
            if (recentProject) {
                if (!waitFor("GET", "/me/time_entries")) {
                    return false;
                }
                respond(last("GET", "/me/time_entries"), 200, recentBody(*recentProject));
            }
            return QTest::qWaitFor([&] {
                return app.timer()->canWrite();
            });
        }

        // The body of the last request that ends with the suffix.
        QJsonObject lastBody(const QByteArray &method, const QByteArray &suffix) const
        {
            return jsonBody(transport.requests.at(last(method, suffix)));
        }

        // Moves the clock one tick per second.
        void advance(int seconds)
        {
            for (int i = 0; i < seconds; ++i) {
                clock.advance(1000);
            }
        }

        // Pomodoro mode on or off through the menu.
        bool setPomodoroMode(bool on)
        {
            QAction *mode = app.statusMenu()->pomodoroModeAction();
            if (mode->isChecked() != on) {
                mode->trigger();
            }
            return app.pomodoroSession()->pomodoroMode() == on && mode->isChecked() == on;
        }

        // Start session from the menu, then the server's answer: a session in
        // its first work phase, started now.
        bool startSession()
        {
            const qsizetype before = transport.requests.size();
            app.statusMenu()->startSessionAction()->trigger();
            const qsizetype post = last("POST", "/app/pomodoro");
            if (post < before) {
                return false;
            }
            respond(post, 200, sessionState(work(clock.now())));
            return app.pomodoroSession()->isActive();
        }

        qint64 revision = 0; // of the last state built
    };

private Q_SLOTS:
    void clientName()
    {
        QCOMPARE(MenuBarApp::clientName(), QStringLiteral("tokkl-macos"));
    }

    // The app's own transport names it in the User-Agent of every request.
    void transportUserAgent()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        QByteArray received;
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket *socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [&received, socket] {
                received += socket->readAll();
                if (received.contains("\r\n\r\n")) {
                    socket->write("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    socket->disconnectFromHost();
                }
            });
        });

        const std::unique_ptr<Transport> transport(MenuBarApp::createTransport());
        PendingReply *reply = transport->send(
            HttpRequest{"GET", QUrl(QStringLiteral("http://127.0.0.1:%1/api/v9/me").arg(server.serverPort())), "Basic eA==", {}});
        QSignalSpy finished(reply, &PendingReply::finished);
        QVERIFY(finished.wait(10000));
        // Header names are case-insensitive; Qt versions differ in the case they send.
        QVERIFY2(received.toLower().contains("\r\nuser-agent: tokkl-macos/"), received.constData());
    }

    void unconfiguredOpensSettings()
    {
        Fixture f;
        QCOMPARE(f.item.title, QStringLiteral("Tokkl"));
        QCOMPARE(f.item.menu, f.app.statusMenu()->menu());
        QSignalSpy shown(&f.app, &MenuBarApp::settingsShown);
        f.app.start();
        QCOMPARE(shown.size(), 1);
        QVERIFY(f.app.settingsWindow()->isVisible());
        QVERIFY(f.transport.requests.isEmpty());
        // Nothing to start or stop yet.
        f.item.click();
        QVERIFY(f.transport.requests.isEmpty());
        QVERIFY(!f.app.statusMenu()->startStopAction()->isEnabled());
    }

    void titleShowsElapsedTime()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        QVERIFY(!f.app.settingsWindow()->isVisible());
        QCOMPARE(f.item.title, QStringLiteral("0:01"));
        // Whole minutes: the title changes when the next minute starts.
        for (int i = 0; i < 54; ++i) {
            f.clock.advance(1000);
        }
        QCOMPARE(f.item.title, QStringLiteral("0:01"));
        f.clock.advance(1000);
        QCOMPARE(f.item.title, QStringLiteral("0:02"));
        QVERIFY2(f.item.toolTip.startsWith(QStringLiteral("Running 0:02 · No project · Connected")), qPrintable(f.item.toolTip));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, No project"));
        QVERIFY(f.app.statusMenu()->stateAction()->text().startsWith(QStringLiteral("Running 0:02")));
    }

    // A click on a running timer pauses it: the server answers with the
    // paused chain, the title keeps the total still, and the words say
    // paused.
    void clickPausesARunningTimer()
    {
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-600);
        QVERIFY(f.connect(chainEntryBody(5, begin)));
        QCOMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, Alpha"));
        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest pause = f.transport.requests.last();
        QCOMPARE(pause.method, QByteArray("POST"));
        QCOMPARE(pause.url.path(), QStringLiteral("/api/app/timer/pause"));
        QCOMPARE(pause.body, QByteArray("{}"));
        // The item shows the mutation in flight and ignores another click.
        QCOMPARE(f.item.title, QStringLiteral("0:10 …"));
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);

        f.respond(before, 200, f.state(QByteArrayLiteral("null"), pauseObject(true, 600)));
        QTRY_VERIFY(f.app.timer()->isPaused());
        QVERIFY(!f.app.timer()->isRunning());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:10"));
        // The total stands still while paused.
        f.advance(120);
        QCOMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Resume the Tokkl timer, Alpha"));
        QVERIFY2(f.item.toolTip.startsWith(QStringLiteral("Paused 0:10 · Alpha · Connected")), qPrintable(f.item.toolTip));
        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY2(menu.stateAction()->text().startsWith(QStringLiteral("Paused 0:10")), qPrintable(menu.stateAction()->text()));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(menu.startStopAction()->isEnabled());
        // The paused entry's project and billable flag, locked.
        QCOMPARE(menu.projectMenu()->title(), QStringLiteral("Project: Alpha"));
        QVERIFY(!menu.projectMenu()->menuAction()->isEnabled());
        QVERIFY(!projectAction(menu, QStringLiteral("Beta (Acme)"))->isEnabled());
        QVERIFY(menu.billableAction()->isChecked());
        QVERIFY(!menu.billableAction()->isEnabled());
        // A still dot in the project colour. Only a running dot pulses.
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.color, QStringLiteral("#06aaf5"));
        QCOMPARE(f.item.indicator.label, QStringLiteral("Alpha"));
    }

    // A chain paused on another device shows paused, and the next click
    // resumes it against the revision shown: the server starts a new entry
    // that copies the paused one, and the title counts on from the paused
    // total.
    void clickResumesAPausedTimer()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), std::nullopt, pauseObject(true, 600)));
        QVERIFY(f.app.timer()->isPaused());
        QCOMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Resume the Tokkl timer, Alpha"));
        // The two minutes paused do not count.
        f.advance(120);
        QCOMPARE(f.item.title, QStringLiteral("0:10"));

        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest resume = f.transport.requests.last();
        QCOMPARE(resume.method, QByteArray("POST"));
        QCOMPARE(resume.url.path(), QStringLiteral("/api/app/timer/resume"));
        QCOMPARE(resume.body, revisionBody(f.revision));

        f.respond(before, 200, f.state(chainEntryBody(6, f.clock.now()), pauseObject(false, 600, 6)));
        QTRY_VERIFY(f.app.timer()->isRunning());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, Alpha"));
        QCOMPARE(f.app.statusMenu()->startStopAction()->text(), QStringLiteral("Stop Timer"));
        // The dot pulses again.
        QVERIFY(f.item.indicator.round);
        QVERIFY(f.item.indicator.pulsing);
        f.advance(60);
        QCOMPARE(f.item.title, QStringLiteral("0:11"));
        QVERIFY(f.app.statusMenu()->stateAction()->text().startsWith(QStringLiteral("Running 0:11")));
    }

    // A click on a stopped timer starts an entry on the selected project,
    // named as the macOS app.
    void clickStartsAStoppedTimer()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Start the Tokkl timer, Beta (Acme)"));
        f.item.click();
        const qsizetype start = f.last("POST", "/workspaces/7/time_entries");
        QVERIFY(start >= 0);
        const QJsonObject body = jsonBody(f.transport.requests.at(start));
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-macos"));
        QCOMPARE(body.value(QStringLiteral("duration")).toInt(), -1);
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
    }

    // The next start defaults to the last entry's project, a pick while
    // stopped wins, and Billable follows the pick.
    void projectMenuWhileStopped()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY(menu.projectMenu()->menuAction()->isEnabled());
        QCOMPARE(menu.projectMenu()->title(), QStringLiteral("Project: Beta (Acme)"));
        QVERIFY(projectAction(menu, QStringLiteral("Beta (Acme)"))->isChecked());
        QVERIFY(!projectAction(menu, QStringLiteral("Alpha"))->isChecked());
        QVERIFY(!menu.billableAction()->isChecked());

        projectAction(menu, QStringLiteral("Alpha"))->trigger();
        QCOMPARE(f.app.timer()->selectedProjectId().toLongLong(), 11);
        QTRY_VERIFY(projectAction(menu, QStringLiteral("Alpha"))->isChecked());
        QVERIFY(!projectAction(menu, QStringLiteral("Beta (Acme)"))->isChecked());
        // Alpha is billable by default.
        QVERIFY(menu.billableAction()->isChecked());
        menu.billableAction()->trigger();
        QVERIFY(!f.app.timer()->billable());
        QVERIFY(!menu.billableAction()->isChecked());

        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        menu.startStopAction()->trigger();
        const QJsonObject body = jsonBody(f.transport.requests.at(f.last("POST", "/workspaces/7/time_entries")));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), false);
    }

    // While an entry runs the project is locked and billable edits the
    // entry in place.
    void projectMenuWhileRunning()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!menu.projectMenu()->menuAction()->isEnabled());
        QCOMPARE(menu.projectMenu()->title(), QStringLiteral("Project: Alpha"));
        QAction *beta = projectAction(menu, QStringLiteral("Beta (Acme)"));
        QVERIFY(beta && !beta->isEnabled());
        QVERIFY(!projectAction(menu, QStringLiteral("No project"))->isEnabled());

        // A pick that reaches the controller anyway is refused.
        const qsizetype before = f.transport.requests.size();
        beta->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QCOMPARE(f.app.timer()->chosenProjectId().toLongLong(), 11);

        QVERIFY(menu.billableAction()->isEnabled());
        menu.billableAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest update = f.transport.requests.last();
        QCOMPARE(update.method, QByteArray("PUT"));
        QCOMPARE(update.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5"));
        QCOMPARE(jsonBody(update), QJsonObject({{QStringLiteral("billable"), true}}));
    }

    // Stop Timer in the menu stops a running timer and ends the chain.
    void stopTimerStopsARunningTimer()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest stop = f.transport.requests.last();
        QCOMPARE(stop.method, QByteArray("PATCH"));
        QCOMPARE(stop.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5/stop"));

        f.respond(before, 200, stoppedEntryBody());
        QTRY_VERIFY(!f.app.timer()->isRunning());
        QVERIFY(!f.app.timer()->isPaused());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        QVERIFY(menu.stateAction()->text().startsWith(QStringLiteral("Stopped 0:00")));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Start the Tokkl timer, No project"));
    }

    // Stop Timer while paused discards the chain on the server, and the next
    // click starts a new entry at 0:00.
    void stopTimerEndsAPausedChain()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), std::nullopt, pauseObject(true, 600)));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(menu.startStopAction()->isEnabled());

        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest discard = f.transport.requests.last();
        QCOMPARE(discard.method, QByteArray("POST"));
        QCOMPARE(discard.url.path(), QStringLiteral("/api/app/timer/discard"));
        QCOMPARE(discard.body, revisionBody(f.revision));
        // Nothing more to send while the answer is on its way.
        QVERIFY(!menu.startStopAction()->isEnabled());

        f.respond(before, 200, f.state());
        QTRY_VERIFY(!f.app.timer()->isPaused());
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        QTRY_VERIFY(menu.startStopAction()->isEnabled());
        QVERIFY(menu.stateAction()->text().startsWith(QStringLiteral("Stopped 0:00")));
        QVERIFY2(f.item.accessibleName.startsWith(QStringLiteral("Start the Tokkl timer, ")), qPrintable(f.item.accessibleName));
        // The paused dot gives way to the stopped square.
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);

        const qsizetype next = f.transport.requests.size();
        f.item.click();
        const qsizetype start = f.last("POST", "/workspaces/7/time_entries");
        QVERIFY(start >= next);
        const QJsonObject body = jsonBody(f.transport.requests.at(start));
        QCOMPARE(body.value(QStringLiteral("description")).toString(), QString());
        QVERIFY(!body.contains(QStringLiteral("task_id")));
    }

    // Stopping a paused chain discards it on the server. While the instance
    // is rate limiting, Stop Timer is disabled and sends nothing.
    void stopTimerWhilePausedAndRateLimited()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), std::nullopt, pauseObject(true, 600)));
        const qsizetype poll = f.transport.requests.size();
        f.advance(30);
        QCOMPARE(f.last("GET", "/app/timer"), poll);
        f.transport.respond(poll, FakeTransport::answer(429, "\"Too many requests\"", "120"));
        QTRY_VERIFY(!f.app.timer()->canWrite());
        QVERIFY(f.app.timer()->isPaused());

        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!menu.startStopAction()->isEnabled());
        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QVERIFY(f.app.timer()->isPaused());
    }

    // While the instance is unreachable Stop Timer still tries. The discard
    // fails, so the chain stays and the tooltip says why; nothing is sent
    // again until a read shows what the server holds.
    void stopTimerWhilePausedAndUnreachable()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), std::nullopt, pauseObject(true, 600)));
        const qsizetype poll = f.transport.requests.size();
        f.advance(30);
        QCOMPARE(f.last("GET", "/app/timer"), poll);
        f.transport.respond(poll, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(f.app.timer()->isStale());

        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY(menu.startStopAction()->isEnabled());
        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.last("POST", "/timer/discard"), before);
        f.transport.respond(before, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(!f.app.timer()->errorString().isEmpty());
        QVERIFY(f.app.timer()->isPaused());
        QVERIFY(!menu.startStopAction()->isEnabled());
    }

    // A pause refused because another device moved the timer first shows the
    // state that refused it and says so.
    void pauseRefusedForAnotherDevice()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.last("POST", "/timer/pause"), before);
        // The timer was stopped elsewhere.
        f.respond(before, 409, f.state());
        QTRY_VERIFY(!f.app.timer()->isRunning());
        QCOMPARE(f.app.timer()->errorString(), QStringLiteral("The timer changed on another device first."));
        QVERIFY2(f.item.toolTip.contains(QStringLiteral("The timer changed on another device first.")), qPrintable(f.item.toolTip));
        QVERIFY(f.app.statusMenu()->stateAction()->toolTip().contains(QStringLiteral("The timer changed on another device first.")));
    }

    // The running entry's project: a pulsing dot in its colour. Stop Timer
    // leaves a still square.
    void indicatorRunningThenStopped()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(f.item.indicator.round);
        QCOMPARE(f.item.indicator.color, QStringLiteral("#06aaf5"));
        QVERIFY(f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, QStringLiteral("Alpha"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, Alpha"));

        f.app.statusMenu()->startStopAction()->trigger();
        f.respond(f.last("PATCH", "/stop"), 200, stoppedEntryBody(qint64(11)));
        QTRY_VERIFY(!f.app.timer()->isRunning());
        QVERIFY(!f.app.timer()->isPaused());
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, StatusWords::projectText(*f.app.timer()));
    }

    // Stopped, the indicator shows the next start's project, still.
    void indicatorShowsTheNextStart()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.color, QStringLiteral("#c7af14"));
        QCOMPARE(f.item.indicator.label, QStringLiteral("Beta (Acme)"));

        f.app.timer()->setSelectedProjectId(qint64(11));
        QTRY_COMPARE(f.item.indicator.color, QStringLiteral("#06aaf5"));
        QCOMPARE(f.item.indicator.label, QStringLiteral("Alpha"));
    }

    // No project is a dashed outline, and a project still being read leaves
    // the slot empty; neither pulses.
    void indicatorWithoutAProject()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Outline);
        QVERIFY(f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, QStringLiteral("No project"));
    }

    void indicatorWhileTheProjectIsRead()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(13))));
        QVERIFY(f.waitFor("GET", "/workspaces/7/projects/13"));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Empty);
        QVERIFY(!f.item.indicator.pulsing);
        f.respond(f.last("GET", "/workspaces/7/projects/13"),
                  200,
                  QByteArrayLiteral(R"({"id":13,"workspace_id":7,"client_id":null,"name":"Gamma","color":"#2da608","active":false,"billable":false})"));
        QTRY_COMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QCOMPARE(f.item.indicator.color, QStringLiteral("#2da608"));
        QVERIFY(f.item.indicator.pulsing);
    }

    // Reduce Motion stops the pulse at once and leaves the dot steady.
    void indicatorUnderReduceMotion()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        QVERIFY(f.item.indicator.pulsing);
        f.item.setReduceMotion(true);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(f.item.indicator.round);
        f.clock.advance(1000);
        QVERIFY(!f.item.indicator.pulsing);
        f.item.setReduceMotion(false);
        QVERIFY(f.item.indicator.pulsing);
    }

    // The pulse runs from full opacity to 0.35 and back every 1.6 s. The ink
    // is the menu bar's text colour and fills a shape without a colour.
    void indicatorDrawingRules()
    {
        QCOMPARE(ProjectIndicator::pulseOpacity(0), 1.0);
        QVERIFY(qFuzzyCompare(ProjectIndicator::pulseOpacity(800), 0.35));
        QVERIFY(qFuzzyCompare(ProjectIndicator::pulseOpacity(400), 0.675));
        QCOMPARE(ProjectIndicator::pulseOpacity(1600), 1.0);
        QVERIFY(qFuzzyCompare(ProjectIndicator::pulseOpacity(2400), 0.35));

        QCOMPARE(ProjectIndicator::inkColor(false), QColor(Qt::black));
        QCOMPARE(ProjectIndicator::inkColor(true), QColor(Qt::white));
        ProjectIndicator indicator;
        indicator.kind = ProjectIndicator::Kind::Filled;
        QCOMPARE(indicator.fillColor(true), QColor(Qt::white));
        QCOMPARE(indicator.fillColor(false), QColor(Qt::black));
        indicator.color = QStringLiteral("#06aaf5");
        QCOMPARE(indicator.fillColor(true), QColor(0x06, 0xaa, 0xf5));
    }

    // The image before the time holds the clock logo from the app's
    // iconset, then the project indicator. Both keep their places in every
    // state, so the time never moves.
    void imageShowsTheLogoBeforeTheIndicator()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        QCOMPARE(f.item.title, QStringLiteral("0:01"));
        const StatusImage running = f.item.image;
        QVERIFY(!running.monochromeLogo);
        QCOMPARE(running.indicator, ProjectIndicator::fromTimer(*f.app.timer(), false));
        QCOMPARE(running.logoRect, QRect(0, 0, 16, 16));
        QCOMPARE(running.indicatorRect, QRect(18, 0, 16, 16));
        QCOMPARE(running.size, QSize(34, 16));
        QVERIFY(running.logoRect.right() < running.indicatorRect.left());

        // The 16 point app icon at 1x and 2x, the files npm run icons renders.
        const QStringList files{QStringLiteral("icon_16x16.png"), QStringLiteral("icon_16x16@2x.png")};
        QCOMPARE(running.logo.size(), files.size());
        for (qsizetype i = 0; i < files.size(); ++i) {
            QImage source(QStringLiteral(TOKKL_ICONSET_DIR "/") + files.at(i));
            QVERIFY2(!source.isNull(), qPrintable(files.at(i)));
            source.setDevicePixelRatio(double(i + 1));
            const QImage &logo = running.logo.at(i);
            QCOMPARE(logo, source);
            QCOMPARE(logo.deviceIndependentSize(), QSizeF(16, 16));
            // Full colour, not the single ink of a template image.
            bool coloured = false;
            for (int y = 0; y < logo.height() && !coloured; ++y) {
                for (int x = 0; x < logo.width() && !coloured; ++x) {
                    const QColor pixel = logo.pixelColor(x, y);
                    coloured = pixel.alpha() == 255 && pixel.hsvSaturation() > 64;
                }
            }
            QVERIFY2(coloured, qPrintable(files.at(i)));
        }

        f.app.statusMenu()->startStopAction()->trigger();
        f.respond(f.last("PATCH", "/stop"), 200, stoppedEntryBody(qint64(11)));
        QTRY_VERIFY(!f.app.timer()->isRunning());
        QVERIFY(f.item.image.indicator != running.indicator);
        QCOMPARE(f.item.image.indicator, f.item.indicator);
        QCOMPARE(f.item.image.logo, running.logo);
        QCOMPARE(f.item.image.logoRect, running.logoRect);
        QCOMPARE(f.item.image.indicatorRect, running.indicatorRect);
        QCOMPARE(f.item.image.size, running.size);
    }

    void monochromePreferenceAppliesAndSurvivesRelaunch()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        const StatusImage before = f.item.image;
        f.app.showSettings();
        SettingsWindow &window = *f.app.settingsWindow();
        QVERIFY(!window.monochromeToggle()->isChecked());
        window.monochromeToggle()->setChecked(true);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(f.item.image.monochromeLogo);
        // The outline logo, at 1x and 2x, in place of the full colour one.
        const QStringList files{QStringLiteral("mono_16x16.png"), QStringLiteral("mono_16x16@2x.png")};
        QCOMPARE(f.item.image.logo.size(), files.size());
        for (qsizetype i = 0; i < files.size(); ++i) {
            QImage source(QStringLiteral(TOKKL_RESOURCES_DIR "/") + files.at(i));
            QVERIFY2(!source.isNull(), qPrintable(files.at(i)));
            source.setDevicePixelRatio(double(i + 1));
            QCOMPARE(f.item.image.logo.at(i), source);
            QCOMPARE(f.item.image.logo.at(i).deviceIndependentSize(), QSizeF(16, 16));
        }
        QVERIFY(f.item.image.logo != before.logo);
        QCOMPARE(f.item.image.logoRect, before.logoRect);
        QCOMPARE(f.item.image.indicator, before.indicator);
        QCOMPARE(f.item.image.size, before.size);

        Fixture relaunched(f.settings.fileName());
        relaunched.app.start();
        QVERIFY(relaunched.item.image.monochromeLogo);
        relaunched.app.showSettings();
        QVERIFY(relaunched.app.settingsWindow()->monochromeToggle()->isChecked());
        relaunched.settings.setValue(SettingsWindow::monochromeIconKey, false);
        relaunched.app.applySettings();
        QVERIFY(!relaunched.item.image.monochromeLogo);
        QCOMPARE(relaunched.item.image.logo, before.logo);
    }

    // Pomodoro mode is a checkable menu item, locked while a session is
    // active and while a timer runs.
    void pomodoroModeItemAndItsLock()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QAction *mode = f.app.statusMenu()->pomodoroModeAction();
        QVERIFY(mode->isCheckable());
        QVERIFY(!mode->isChecked());
        QVERIFY(mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode"));
        QVERIFY(!f.app.pomodoroSession()->pomodoroMode());

        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.startSession());
        QVERIFY(mode->isChecked());
        QVERIFY(!mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode (locked while running)"));

        f.app.statusMenu()->endSessionAction()->trigger();
        QVERIFY(f.app.pomodoroSession()->isActive());
        f.respond(f.last("POST", "/app/pomodoro/end"), 200, f.state());
        QVERIFY(!f.app.pomodoroSession()->isActive());
        QVERIFY(mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode"));
        QVERIFY(f.setPomodoroMode(false));

        Fixture running;
        QVERIFY(running.connect(entryBody()));
        QAction *locked = running.app.statusMenu()->pomodoroModeAction();
        QVERIFY(!locked->isChecked());
        QVERIFY(!locked->isEnabled());
        QCOMPARE(locked->text(), QStringLiteral("Pomodoro mode (locked while running)"));
    }

    // The menu in Pomodoro mode: Start session while idle, then Next phase
    // and End session. Start Timer and Stop Timer are for Timer mode, and
    // Project and Billable stay enabled during a session. A pomodoro too
    // short to save is reported under the state line.
    void menuInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        StatusMenu &menu = *f.app.statusMenu();
        PomodoroSession &session = *f.app.pomodoroSession();
        QVERIFY(menu.startStopAction()->isVisible());
        QVERIFY(!menu.startSessionAction()->isVisible());
        QVERIFY(!menu.nextPhaseAction()->isVisible());
        QVERIFY(!menu.endSessionAction()->isVisible());
        QVERIFY(!menu.messageAction()->isVisible());

        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(!menu.startStopAction()->isVisible());
        QVERIFY(!menu.startStopAction()->isEnabled());
        QVERIFY(menu.startSessionAction()->isVisible());
        QVERIFY(menu.startSessionAction()->isEnabled());
        QCOMPARE(menu.startSessionAction()->text(), QStringLiteral("Start session"));
        QVERIFY(!menu.nextPhaseAction()->isVisible());
        QVERIFY(!menu.endSessionAction()->isVisible());
        QVERIFY(menu.stateAction()->text().startsWith(QStringLiteral("Stopped 0:00")));

        // Start session sends the chosen project and billable flag; the
        // server takes the account's lengths.
        const qsizetype before = f.transport.requests.size();
        menu.startSessionAction()->trigger();
        QCOMPARE(f.last("POST", "/app/pomodoro"), before);
        const QJsonObject start = f.lastBody("POST", "/app/pomodoro");
        QCOMPARE(start.value(QStringLiteral("project_id")).toInteger(), 12);
        QCOMPARE(start.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-macos"));
        // Another start waits for the answer.
        QVERIFY(!menu.startSessionAction()->isEnabled());
        const QDateTime begin = f.clock.now();
        f.respond(before, 200, f.sessionState(work(begin)));
        QVERIFY(session.isActive());
        QVERIFY(!menu.startSessionAction()->isVisible());
        QVERIFY(!menu.startStopAction()->isVisible());
        QVERIFY(menu.nextPhaseAction()->isVisible());
        QCOMPARE(menu.nextPhaseAction()->text(), QStringLiteral("Next phase: Short rest"));
        QVERIFY(menu.endSessionAction()->isVisible());
        QCOMPARE(menu.endSessionAction()->text(), QStringLiteral("End session"));
        QCOMPARE(menu.stateAction()->text(), QStringLiteral("Work · 1:00 left · Pomodoro 1 of 2"));
        QVERIFY(menu.projectMenu()->menuAction()->isEnabled());
        QVERIFY(projectAction(menu, QStringLiteral("Alpha"))->isEnabled());
        QVERIFY(menu.billableAction()->isEnabled());

        // Next phase sends the revision shown.
        f.advance(60);
        menu.nextPhaseAction()->trigger();
        QCOMPARE(f.lastBody("POST", "/app/pomodoro/next"), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QCOMPARE(session.phase(), QStringLiteral("shortRest"));
        QCOMPARE(menu.nextPhaseAction()->text(), QStringLiteral("Next phase: Work"));
        QCOMPARE(menu.stateAction()->text(), QStringLiteral("Short rest · 1:00 left · Pomodoro 1 of 2"));

        // End session ends it on the server. A pomodoro too short to save
        // is dropped and told.
        menu.endSessionAction()->trigger();
        QCOMPARE(f.lastBody("POST", "/app/pomodoro/end"), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        f.respond(f.last("POST", "/app/pomodoro/end"), 200, f.state(QByteArrayLiteral("null"), QJsonValue::Null, QJsonValue::Null, discardedJson(f.clock.now())));
        QVERIFY(!session.isActive());
        QVERIFY(menu.messageAction()->isVisible());
        QVERIFY(!menu.messageAction()->isEnabled());
        QCOMPARE(menu.messageAction()->text(), QStringLiteral("This pomodoro was too short to save."));
        QVERIFY(menu.startSessionAction()->isVisible());
        QVERIFY(!menu.nextPhaseAction()->isVisible());
        QVERIFY(!menu.endSessionAction()->isVisible());
        QVERIFY(menu.pomodoroModeAction()->isEnabled());
    }

    // A session started on another device shows in Timer mode: the state
    // line, the title and the tooltip say so, Next phase and End session are
    // there, the timer toggle is gone and the mode is locked. Ending it
    // elsewhere brings the toggle back.
    void sessionStartedElsewhereShowsInTimerMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        StatusMenu &menu = *f.app.statusMenu();
        PomodoroSession &session = *f.app.pomodoroSession();
        QVERIFY(!session.pomodoroMode());
        QVERIFY(menu.startStopAction()->isVisible());

        const QDateTime begin = f.clock.now().addSecs(-10);
        QVERIFY(f.push(f.sessionState(work(begin))));
        QVERIFY(session.isActive());
        QVERIFY(f.app.timer()->isSessionActive());
        QVERIFY(!session.pomodoroMode());
        QCOMPARE(f.item.title, QStringLiteral("0:50"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · 0:50 left · Pomodoro 1 of 2"));
        QCOMPARE(f.item.accessibleName, f.item.toolTip);
        QCOMPARE(menu.stateAction()->text(), f.item.toolTip);
        QVERIFY(!menu.startStopAction()->isVisible());
        QVERIFY(!menu.startStopAction()->isEnabled());
        QVERIFY(!menu.startSessionAction()->isVisible());
        QVERIFY(menu.nextPhaseAction()->isVisible());
        QCOMPARE(menu.nextPhaseAction()->text(), QStringLiteral("Next phase: Short rest"));
        QVERIFY(menu.endSessionAction()->isVisible());
        // The mode is locked while the session runs, wherever it began.
        QVERIFY(!menu.pomodoroModeAction()->isChecked());
        QVERIFY(!menu.pomodoroModeAction()->isEnabled());
        QCOMPARE(menu.pomodoroModeAction()->text(), QStringLiteral("Pomodoro mode (locked while running)"));
        QVERIFY(!f.setPomodoroMode(true));

        // The click opens the menu before the planned end and confirms Next
        // phase after it; it starts no timer.
        f.item.click();
        QCOMPARE(f.item.menuPopUps, 1);
        QVERIFY(f.find("POST", "/time_entries").isEmpty());
        f.advance(50);
        QVERIFY(session.isRinging());
        f.item.click();
        QCOMPARE(f.item.menuPopUps, 1);
        QVERIFY(f.last("POST", "/app/pomodoro/next") >= 0);
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QCOMPARE(f.item.title, QStringLiteral("1:00"));
        QCOMPARE(menu.nextPhaseAction()->text(), QStringLiteral("Next phase: Work"));

        // The other device ends it.
        QVERIFY(f.push(f.state()));
        QVERIFY(!session.isActive());
        QVERIFY(!menu.nextPhaseAction()->isVisible());
        QVERIFY(!menu.endSessionAction()->isVisible());
        QVERIFY(menu.startStopAction()->isVisible());
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        QTRY_VERIFY(menu.startStopAction()->isEnabled());
        QVERIFY(menu.pomodoroModeAction()->isEnabled());
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
    }

    // A session read at start, in Pomodoro mode, hides Start session too.
    void sessionStartedElsewhereInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.connect(chainEntryBody(41, f.clock.now()), std::nullopt, QJsonValue::Null, pomodoroJson(work(f.clock.now()), 41)));
        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY(f.app.pomodoroSession()->isActive());
        QVERIFY(!menu.startSessionAction()->isVisible());
        QVERIFY(!menu.startStopAction()->isVisible());
        QVERIFY(menu.nextPhaseAction()->isVisible());
        QVERIFY(menu.endSessionAction()->isVisible());
        QVERIFY(!menu.pomodoroModeAction()->isEnabled());
    }

    // Start session is disabled until a state has been read, and while an
    // action waits for its answer.
    void startSessionWaitsForAState()
    {
        Fixture f;
        QVERIFY(f.setPomodoroMode(true));
        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY(menu.startSessionAction()->isVisible());
        QVERIFY(!menu.startSessionAction()->isEnabled());
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(menu.startSessionAction()->isEnabled());
    }

    // A refused action leaves its message under the state line; the next
    // action clears it.
    void sessionActionFailureShowsItsMessage()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        StatusMenu &menu = *f.app.statusMenu();
        const qsizetype before = f.transport.requests.size();
        menu.startSessionAction()->trigger();
        QCOMPARE(f.last("POST", "/app/pomodoro"), before);
        f.respond(before, 422, QByteArrayLiteral("\"No such project\""));
        QTRY_VERIFY(!f.app.pomodoroSession()->message().isEmpty());
        QVERIFY(!f.app.pomodoroSession()->isActive());
        QVERIFY(menu.messageAction()->isVisible());
        QCOMPARE(menu.messageAction()->text(), f.app.pomodoroSession()->message());
        QTRY_VERIFY(menu.startSessionAction()->isEnabled());
    }

    // The session keeps counting from the last state held when the instance
    // cannot be reached, and the words and the title say it is offline.
    void sessionWhileOffline()
    {
        Fixture f;
        QVERIFY(f.connect(chainEntryBody(41, f.clock.now()), std::nullopt, QJsonValue::Null, pomodoroJson(work(f.clock.now()), 41)));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(f.item.title, QStringLiteral("1:00"));

        const qsizetype poll = f.transport.requests.size();
        f.advance(30);
        QCOMPARE(f.last("GET", "/app/timer"), poll);
        f.transport.respond(poll, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(f.app.timer()->isStale());
        QCOMPARE(f.item.title, QStringLiteral("0:30 !"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · 0:30 left · Pomodoro 1 of 2 · Offline, showing the last known state"));
        QCOMPARE(menu.stateAction()->text(), f.item.toolTip);
        // The name for a screen reader stays short.
        QCOMPARE(f.item.accessibleName, QStringLiteral("Work · 0:30 left · Pomodoro 1 of 2"));

        // Next phase still tries; when the request fails the menu says why.
        menu.nextPhaseAction()->trigger();
        const qsizetype next = f.last("POST", "/app/pomodoro/next");
        QVERIFY(next > poll);
        f.transport.respond(next, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(!f.app.pomodoroSession()->message().isEmpty());
        QVERIFY(menu.messageAction()->isVisible());
        QCOMPARE(menu.messageAction()->text(), f.app.pomodoroSession()->message());
    }

    // During a session the title counts the phase down, then the overtime up,
    // and the tooltip and the accessible name name the phase. Without a
    // session the timer's words get the mode.
    void titleCountsTheSessionDownThenOvertime()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Stopped 0:00 · No project · Connected · Pomodoro mode"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Start a Pomodoro session, No project · Pomodoro mode"));

        QVERIFY(f.startSession());
        QCOMPARE(f.item.title, QStringLiteral("1:00"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · 1:00 left · Pomodoro 1 of 2"));
        QCOMPARE(f.item.accessibleName, f.item.toolTip);
        f.advance(59);
        QCOMPARE(f.item.title, QStringLiteral("0:01"));
        f.advance(1);
        QCOMPARE(f.item.title, QStringLiteral("+0:00"));
        f.advance(65);
        QCOMPARE(f.item.title, QStringLiteral("+1:05"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · +1:05 overtime · Pomodoro 1 of 2"));
        QCOMPARE(f.item.accessibleName, f.item.toolTip);
        QCOMPARE(f.app.statusMenu()->stateAction()->text(), f.item.toolTip);
    }

    // A primary click in Pomodoro mode starts a session, opens the menu in
    // mid-phase and confirms Next phase while the alarm rings.
    void clickInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        PomodoroSession &session = *f.app.pomodoroSession();

        // The session starts once the server answers. A click while the
        // request is on its way does nothing.
        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        QCOMPARE(f.last("POST", "/app/pomodoro"), before);
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        QCOMPARE(f.item.menuPopUps, 0);
        f.respond(before, 200, f.sessionState(work(f.clock.now())));
        QVERIFY(session.isActive());
        QCOMPARE(session.phase(), QStringLiteral("work"));

        // Mid-phase the click opens the menu and changes nothing.
        f.item.click();
        QCOMPARE(f.item.menuPopUps, 1);
        QCOMPARE(f.transport.requests.size(), before + 1);
        QCOMPARE(session.phase(), QStringLiteral("work"));

        // Ringing, it confirms Next phase.
        f.advance(61);
        QVERIFY(session.isRinging());
        const QDateTime begin = f.clock.now().addSecs(-61);
        f.item.click();
        const qsizetype next = f.last("POST", "/app/pomodoro/next");
        QVERIFY(next > before);
        f.respond(next, 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QCOMPARE(session.phase(), QStringLiteral("shortRest"));
        QVERIFY(!session.isRinging());
        QCOMPARE(f.item.menuPopUps, 1);
    }

    // A timer running from another device keeps the timer's click, words and
    // menu in Pomodoro mode; only the hourglass shows the mode.
    void clickInPomodoroModeLeavesARunningTimerToTheTimer()
    {
        Fixture f;
        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.connect(entryBody()));
        QCOMPARE(f.item.title, QStringLiteral("0:01"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, No project · Pomodoro mode"));
        QVERIFY2(f.item.toolTip.startsWith(QStringLiteral("Running 0:01 · No project · Connected")), qPrintable(f.item.toolTip));
        QVERIFY(f.item.toolTip.endsWith(QStringLiteral(" · Pomodoro mode")));
        QVERIFY(!f.item.image.hourglass.isEmpty());
        StatusMenu &menu = *f.app.statusMenu();
        QVERIFY(menu.startStopAction()->isVisible());
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!menu.startSessionAction()->isVisible());

        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.last("POST", "/timer/pause"), before);
        QCOMPARE(f.item.menuPopUps, 0);
    }

    // The wake hook reaches the session as well as the timer: after a sleep
    // past the planned end the title shows the overtime before the next tick.
    void wakeUpdatesTheSession()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.startSession());
        f.clock.current = f.clock.current.addSecs(90);
        QCOMPARE(f.item.title, QStringLiteral("1:00"));

        const qsizetype before = f.transport.requests.size();
        f.app.resumed();
        QCOMPARE(f.item.title, QStringLiteral("+0:30"));
        QVERIFY(f.app.pomodoroSession()->isRinging());
        // The state client reads the state again at once.
        QVERIFY(f.waitFor("GET", "/app/timer", before - 1));
    }

    // The alarm: the sound chosen for the transition loops from the moment
    // the phase rings until Next phase, and the choice in settings wins
    // over the catalogue's default. Nothing plays before the planned end.
    void alarmLoopsWhileRingingAndStopsOnNextPhase()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        const QDateTime begin = f.clock.now();
        QVERIFY(f.startSession());
        QVERIFY(f.player.loops.isEmpty());

        f.advance(60);
        QVERIFY(f.app.pomodoroSession()->isRinging());
        QCOMPARE(f.app.pomodoroSession()->ringingTransition(), QStringLiteral("workToShortRest"));
        QCOMPARE(f.player.looping, soundFile(QStringLiteral("work-to-short-rest")));
        // Ticks past the end change nothing: the same file keeps looping.
        f.advance(5);
        QCOMPARE(f.player.loops.size(), 1);

        QVERIFY(f.app.statusMenu()->nextPhaseAction()->isEnabled());
        f.app.statusMenu()->nextPhaseAction()->trigger();
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QVERIFY(!f.app.pomodoroSession()->isRinging());
        QVERIFY(f.player.looping.isEmpty());
        QCOMPARE(f.player.stops, 1);

        // The short rest ends with the sound chosen for it.
        f.settings.setValue(PomodoroAlarm::soundKey(TransitionKind::ShortRestToWork), QStringLiteral("long-rest-to-work"));
        f.advance(60);
        QCOMPARE(f.player.looping, soundFile(QStringLiteral("long-rest-to-work")));
        // The other device ends the session, which stops it too.
        QVERIFY(f.push(f.state()));
        QVERIFY(f.player.looping.isEmpty());
        QCOMPARE(f.player.stops, 2);
    }

    // The mode is kept in the app's settings, so a relaunch comes back in
    // Pomodoro mode.
    void pomodoroModeSurvivesRelaunch()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));

        Fixture relaunched(f.settings.fileName());
        QVERIFY(relaunched.app.pomodoroSession()->pomodoroMode());
        QVERIFY(relaunched.app.statusMenu()->pomodoroModeAction()->isChecked());
        QVERIFY(!relaunched.item.image.hourglass.isEmpty());
        QVERIFY(relaunched.app.pomodoroPreferences());
    }

    // In Pomodoro mode the hourglass follows the indicator, with the gap
    // between the logo and the indicator: the colour glyph, or with the
    // monochrome logo the outline glyph the menu bar tints the same way.
    void imageShowsTheHourglassInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        const StatusImage timerMode = f.item.image;
        QVERIFY(timerMode.hourglass.isEmpty());
        QCOMPARE(timerMode.size, QSize(34, 16));

        QVERIFY(f.setPomodoroMode(true));
        const StatusImage colour = f.item.image;
        QCOMPARE(colour.logoRect, timerMode.logoRect);
        QCOMPARE(colour.indicatorRect, timerMode.indicatorRect);
        QCOMPARE(colour.hourglassRect, QRect(36, 0, 16, 16));
        QCOMPARE(colour.size, QSize(52, 16));
        QVERIFY(!colour.monochromeLogo);
        compareWithResources(colour.hourglass, {QStringLiteral("hourglass_16x16.png"), QStringLiteral("hourglass_16x16@2x.png")});
        if (QTest::currentTestFailed()) {
            return;
        }

        f.settings.setValue(SettingsWindow::monochromeIconKey, true);
        f.app.applySettings();
        QVERIFY(f.item.image.monochromeLogo);
        QCOMPARE(f.item.image.hourglassRect, colour.hourglassRect);
        QCOMPARE(f.item.image.size, colour.size);
        compareWithResources(f.item.image.hourglass, {QStringLiteral("hourglass_mono_16x16.png"), QStringLiteral("hourglass_mono_16x16@2x.png")});
        if (QTest::currentTestFailed()) {
            return;
        }

        QVERIFY(f.setPomodoroMode(false));
        QVERIFY(f.item.image.hourglass.isEmpty());
        QCOMPARE(f.item.image.size, timerMode.size);
    }

    void openAndSettingsActions()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        StatusMenu &menu = *f.app.statusMenu();
        QSignalSpy open(&f.app, &MenuBarApp::openUrlRequested);
        menu.openAction()->trigger();
        QCOMPARE(open.size(), 1);
        QCOMPARE(open.first().first().toUrl(), QUrl(QStringLiteral("https://a.example.test/")));
        QSignalSpy quit(&f.app, &MenuBarApp::quitRequested);
        menu.quitAction()->trigger();
        QCOMPARE(quit.size(), 1);
        menu.settingsAction()->trigger();
        QVERIFY(f.app.settingsWindow()->isVisible());
    }

    // Save keeps the address, method and email in the settings and the token
    // in the store only; the connection picks them up.
    void settingsSaveToken()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        QVERIFY(window.tokenButton()->isChecked());
        QVERIFY(!window.emailField()->isVisibleTo(&window));
        window.urlField()->setText(QStringLiteral("  https://a.example.test/tokkl/  "));
        QTest::keyClicks(window.secretField(), token);
        QVERIFY(window.testButton()->isEnabled());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);

        QCOMPARE(f.settings.value(SettingsWindow::instanceUrlKey).toString(), QStringLiteral("https://a.example.test/tokkl"));
        QCOMPARE(f.settings.value(SettingsWindow::authModeKey).toString(), QStringLiteral("token"));
        const QString key = credentialKey(parseInstanceUrl(QStringLiteral("https://a.example.test/tokkl")), AuthMode::Token, QString());
        QCOMPARE(f.store.secrets.value(key), token);
        QCOMPARE(f.app.connection()->instanceUrl(), QStringLiteral("https://a.example.test/tokkl"));

        f.settings.sync();
        QFile file(f.settings.fileName());
        QVERIFY(file.open(QIODevice::ReadOnly));
        QVERIFY(!file.readAll().contains(token.toUtf8()));

        QVERIFY(f.waitFor("GET", "/me"));
        QCOMPARE(f.transport.requests.at(f.last("GET", "/me")).url.path(), QStringLiteral("/tokkl/api/v9/me"));
    }

    // Save waits for the store: the settings change, saved() comes and the
    // window closes only once the store has kept the secret.
    void settingsCloseOnceTheStoreKeepsTheSecret()
    {
        Fixture f;
        f.store.hold = true;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        QVERIFY(window.isVisible());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        window.urlField()->setText(instance);
        QTest::keyClicks(window.secretField(), token);
        window.monochromeToggle()->setChecked(true);
        window.saveButton()->click();

        QTRY_COMPARE(f.store.held.size(), 1);
        QCoreApplication::processEvents();
        QCOMPARE(saved.count(), 0);
        QVERIFY(window.isVisible());
        QVERIFY(!window.saveButton()->isEnabled());
        QVERIFY(!f.settings.contains(SettingsWindow::instanceUrlKey));
        QVERIFY(!f.settings.contains(SettingsWindow::monochromeIconKey));
        // The pending save owns a snapshot, even if the checkbox changes.
        window.monochromeToggle()->setChecked(false);
        QVERIFY(f.app.connection()->instanceUrl().isEmpty());

        f.store.finish(CredentialResult::Status::Ok);
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(!window.isVisible());
        QCOMPARE(f.settings.value(SettingsWindow::instanceUrlKey).toString(), instance);
        QCOMPARE(f.store.secrets.value(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString())), token);
        QCOMPARE(f.app.connection()->instanceUrl(), instance);
        QVERIFY(f.settings.value(SettingsWindow::monochromeIconKey).toBool());
        QVERIFY(f.item.image.monochromeLogo);
    }

    // A failed write keeps the window open with the typed secret and the
    // store's error, and changes no setting. Save works again afterwards.
    void settingsStayOpenWhenTheStoreFails()
    {
        Fixture f;
        f.store.hold = true;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        QSignalSpy saved(&window, &SettingsWindow::saved);
        window.urlField()->setText(instance);
        QTest::keyClicks(window.secretField(), token);
        window.monochromeToggle()->setChecked(true);
        window.saveButton()->click();
        QTRY_COMPARE(f.store.held.size(), 1);

        f.store.finish(CredentialResult::Status::Unavailable);
        QTRY_VERIFY(window.storeError()->isVisibleTo(&window));
        QCOMPARE(window.storeError()->text(), f.store.message(CredentialResult{CredentialResult::Status::Unavailable, {}}));
        QCOMPARE(saved.count(), 0);
        QVERIFY(window.isVisible());
        QCOMPARE(window.secretField()->text(), token);
        QVERIFY(window.saveButton()->isEnabled());
        QVERIFY(!f.settings.contains(SettingsWindow::instanceUrlKey));
        QVERIFY(!f.settings.contains(SettingsWindow::monochromeIconKey));
        QVERIFY(!f.item.image.monochromeLogo);
        QVERIFY(f.store.secrets.isEmpty());

        window.saveButton()->click();
        QTRY_COMPARE(f.store.held.size(), 1);
        QVERIFY(!window.storeError()->isVisibleTo(&window));
        f.store.finish(CredentialResult::Status::Ok);
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(!window.isVisible());
        QCOMPARE(f.settings.value(SettingsWindow::instanceUrlKey).toString(), instance);
    }

    void settingsRefuseCredentialsInTheAddress()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        window.urlField()->setText(QStringLiteral("https://bea:secret@a.example.test"));
        QVERIFY(window.urlNote()->isVisibleTo(&window));
        QVERIFY(!window.save());
        QVERIFY(!f.settings.contains(SettingsWindow::instanceUrlKey));
    }

    void settingsPasswordAndTestConnection()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        window.urlField()->setText(instance);
        window.passwordButton()->setChecked(true);
        QVERIFY(window.emailField()->isVisibleTo(&window));
        window.emailField()->setText(QStringLiteral("bea@example.test"));
        QTest::keyClicks(window.secretField(), QStringLiteral("pw-1"));
        QVERIFY(window.testButton()->isEnabled());

        window.testButton()->click();
        const qsizetype test = f.last("GET", "/me");
        QVERIFY(test >= 0);
        QCOMPARE(f.transport.requests.at(test).authorization, QByteArray("Basic ") + QByteArray("bea@example.test:pw-1").toBase64());
        QCOMPARE(window.testResult()->text(), QStringLiteral("Testing…"));
        f.respond(test, 200, meBody());
        QCOMPARE(window.setup()->testResult(), ConnectionSetup::Succeeded);
        QVERIFY2(window.testResult()->text().contains(QStringLiteral("Connected as Bea")), qPrintable(window.testResult()->text()));

        window.testButton()->click();
        f.respond(f.last("GET", "/me"), 401, QByteArrayLiteral(R"({"error":"bad"})"));
        QCOMPARE(window.setup()->testResult(), ConnectionSetup::Failed);
        QVERIFY(window.testResult()->text().contains(QStringLiteral("refused")));

        // Nothing is kept before Save.
        QVERIFY(f.store.secrets.isEmpty());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);
        QCOMPARE(f.settings.value(SettingsWindow::authModeKey).toString(), QStringLiteral("password"));
        QCOMPARE(f.settings.value(SettingsWindow::emailKey).toString(), QStringLiteral("bea@example.test"));
        QCOMPARE(f.store.secrets.size(), 1);
    }

    // A secret typed and not saved is gone when the window opens again; the
    // stored one comes back.
    void settingsReopenDropsUnsavedSecret()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        SettingsWindow &window = *f.app.settingsWindow();
        f.app.showSettings();
        QTRY_COMPARE(window.secretField()->text(), token);
        window.secretField()->clear();
        QTest::keyClicks(window.secretField(), QStringLiteral("typed"));
        window.close();
        f.app.showSettings();
        QTRY_COMPARE(window.secretField()->text(), token);
    }

    // Opening the window reads the lengths again, and the spin boxes take
    // the server's values inside the shared ranges.
    void pomodoroSettingsLoadTheLengths()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.app.settingsWindow();
        const qsizetype before = f.transport.requests.size();
        f.app.showSettings();
        QVERIFY(f.waitFor("GET", "/me/preferences", before - 1));
        f.respond(f.last("GET", "/me/preferences"), 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":30,"pomodoro_break_interval_in_minutes":7,)"
            R"("pomodoro_long_break_interval_in_minutes":20,"pomodoro_long_break_every":3})"));

        QTRY_COMPARE(window.lengthBox(PomodoroField::WorkMinutes)->value(), 30);
        QCOMPARE(window.lengthBox(PomodoroField::ShortRestMinutes)->value(), 7);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestMinutes)->value(), 20);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestEvery)->value(), 3);
        for (const PomodoroField field : {PomodoroField::WorkMinutes, PomodoroField::ShortRestMinutes, PomodoroField::LongRestMinutes, PomodoroField::LongRestEvery}) {
            QVERIFY(!window.lengthBox(field)->isReadOnly());
            QVERIFY(!window.lengthError(field)->isVisibleTo(&window));
        }
        QCOMPARE(window.lengthBox(PomodoroField::WorkMinutes)->minimum(), 1);
        QCOMPARE(window.lengthBox(PomodoroField::WorkMinutes)->maximum(), 180);
        QCOMPARE(window.lengthBox(PomodoroField::ShortRestMinutes)->minimum(), 1);
        QCOMPARE(window.lengthBox(PomodoroField::ShortRestMinutes)->maximum(), 60);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestMinutes)->minimum(), 1);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestMinutes)->maximum(), 60);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestEvery)->minimum(), 1);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestEvery)->maximum(), 12);
        QVERIFY(!window.lengthsNote()->isVisibleTo(&window));
    }

    // Save posts the lengths that changed, and only those, next to the
    // Keychain write, and the window closes once both are done.
    void pomodoroSettingsSavePostsTheChangedLengths()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.app.settingsWindow();
        f.app.showSettings();
        QVERIFY(f.waitFor("GET", "/me/preferences", qsizetype(f.transport.requests.size()) - 2));
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(window.secretField()->text(), token);
        QTRY_COMPARE(window.lengthBox(PomodoroField::WorkMinutes)->value(), 1);

        window.lengthBox(PomodoroField::WorkMinutes)->setValue(30);
        window.lengthBox(PomodoroField::LongRestEvery)->setValue(3);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        const qsizetype before = f.transport.requests.size();
        window.saveButton()->click();
        const qsizetype post = f.last("POST", "/me/preferences");
        QVERIFY(post >= before);
        QCOMPARE(jsonBody(f.transport.requests.at(post)),
                 (QJsonObject{{QStringLiteral("pomodoro_focus_interval_in_minutes"), 30}, {QStringLiteral("pomodoro_long_break_every"), 3}}));
        // The Keychain has the secret; the window waits for the server.
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(window.isVisible());
        QVERIFY(!window.saveButton()->isEnabled());

        f.respond(post, 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":30,"pomodoro_break_interval_in_minutes":1,)"
            R"("pomodoro_long_break_interval_in_minutes":1,"pomodoro_long_break_every":3})"));
        QTRY_VERIFY(!window.isVisible());
        QCOMPARE(f.app.pomodoroPreferences()->workMinutes(), 30);
        QVERIFY(window.saveButton()->isEnabled());

        // Nothing changed: Save posts no lengths and closes once the
        // Keychain has the secret.
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(window.secretField()->text(), token);
        const qsizetype again = f.transport.requests.size();
        window.saveButton()->click();
        QTRY_VERIFY(!window.isVisible());
        QCOMPARE(f.find("POST", "/me/preferences").size(), 1);
        QVERIFY(f.transport.requests.size() >= again);
    }

    // A 400 that names a key shows next to its field, the window stays
    // open and Save works again.
    void pomodoroSettingsShowARefusedLengthNextToItsField()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.app.settingsWindow();
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(window.secretField()->text(), token);

        window.lengthBox(PomodoroField::LongRestMinutes)->setValue(45);
        window.saveButton()->click();
        const qsizetype post = f.last("POST", "/me/preferences");
        QVERIFY(post >= 0);
        f.respond(post, 400, QByteArrayLiteral(R"("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60")"));
        QTRY_VERIFY(window.lengthError(PomodoroField::LongRestMinutes)->isVisibleTo(&window));
        QCOMPARE(window.lengthError(PomodoroField::LongRestMinutes)->text(),
                 QStringLiteral("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60"));
        QVERIFY(!window.lengthError(PomodoroField::WorkMinutes)->isVisibleTo(&window));
        QVERIFY(!window.pomodoroError()->isVisibleTo(&window));
        QVERIFY(window.isVisible());
        QVERIFY(window.saveButton()->isEnabled());
        // The typed value stays for another try.
        QCOMPARE(window.lengthBox(PomodoroField::LongRestMinutes)->value(), 45);

        // A failure that names no field is the general error.
        window.saveButton()->click();
        f.respond(f.last("POST", "/me/preferences"), 400, QByteArrayLiteral(R"("Preferences are too large")"));
        QTRY_VERIFY(window.pomodoroError()->isVisibleTo(&window));
        QCOMPARE(window.pomodoroError()->text(), QStringLiteral("Preferences are too large"));
        QVERIFY(!window.lengthError(PomodoroField::LongRestMinutes)->isVisibleTo(&window));
        QVERIFY(window.isVisible());
    }

    // Without a validated account the lengths show as last read, cannot be
    // edited, and a note says why.
    void pomodoroSettingsAreReadOnlyWithoutAnAccount()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        QVERIFY(window.isVisible());
        QVERIFY(f.transport.requests.isEmpty());
        QCOMPARE(window.lengthBox(PomodoroField::WorkMinutes)->value(), 25);
        QCOMPARE(window.lengthBox(PomodoroField::ShortRestMinutes)->value(), 5);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestMinutes)->value(), 15);
        QCOMPARE(window.lengthBox(PomodoroField::LongRestEvery)->value(), 4);
        for (const PomodoroField field : {PomodoroField::WorkMinutes, PomodoroField::ShortRestMinutes, PomodoroField::LongRestMinutes, PomodoroField::LongRestEvery}) {
            QVERIFY(window.lengthBox(field)->isReadOnly());
        }
        QVERIFY(window.lengthsNote()->isVisibleTo(&window));
        QVERIFY(window.lengthsNote()->text().contains(QStringLiteral("connection")));
        QVERIFY(!window.pomodoroError()->isVisibleTo(&window));
    }

    // The sound choices list the catalogue, default to the sound named
    // after the transition, are kept by Save next to the other settings and
    // come back on the next launch.
    void pomodoroSoundChoiceIsStoredAndReadBack()
    {
        const QList<PomodoroSound> sounds = pomodoroSounds();
        QCOMPARE(sounds.size(), 4);
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        QComboBox *box = window.soundBox(TransitionKind::WorkToShortRest);
        QCOMPARE(box->count(), 4);
        for (int i = 0; i < 4; ++i) {
            QCOMPARE(box->itemText(i), sounds.at(i).label);
        }
        QCOMPARE(box->currentIndex(), 0);
        QCOMPARE(window.soundBox(TransitionKind::ShortRestToWork)->currentIndex(), 1);
        QCOMPARE(window.soundBox(TransitionKind::WorkToLongRest)->currentIndex(), 2);
        QCOMPARE(window.soundBox(TransitionKind::LongRestToWork)->currentIndex(), 3);

        box->setCurrentIndex(3);
        QVERIFY(!f.settings.contains(PomodoroAlarm::soundKey(TransitionKind::WorkToShortRest)));
        window.urlField()->setText(instance);
        QTest::keyClicks(window.secretField(), token);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        window.saveButton()->click();
        QTRY_COMPARE(saved.count(), 1);
        QCOMPARE(f.settings.value(PomodoroAlarm::soundKey(TransitionKind::WorkToShortRest)).toString(), QStringLiteral("long-rest-to-work"));
        // The untouched choices are kept as they showed.
        QCOMPARE(f.settings.value(PomodoroAlarm::soundKey(TransitionKind::ShortRestToWork)).toString(), QStringLiteral("short-rest-to-work"));
        QCOMPARE(PomodoroAlarm::chosenSound(&f.settings, TransitionKind::WorkToShortRest), QStringLiteral("long-rest-to-work"));
        QCOMPARE(PomodoroAlarm::chosenSound(&f.settings, TransitionKind::ShortRestToWork), QStringLiteral("short-rest-to-work"));

        Fixture relaunched(f.settings.fileName());
        relaunched.app.showSettings();
        QCOMPARE(relaunched.app.settingsWindow()->soundBox(TransitionKind::WorkToShortRest)->currentIndex(), 3);
        QCOMPARE(relaunched.app.settingsWindow()->soundBox(TransitionKind::LongRestToWork)->currentIndex(), 3);
    }

    // Preview plays the sound selected next to it once, through the player,
    // without saving.
    void previewPlaysTheSelectedSound()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.app.settingsWindow();
        window.soundBox(TransitionKind::LongRestToWork)->setCurrentIndex(1);
        window.previewButton(TransitionKind::LongRestToWork)->click();
        QCOMPARE(f.player.previews, QStringList{soundFile(QStringLiteral("short-rest-to-work"))});
        window.previewButton(TransitionKind::WorkToLongRest)->click();
        QCOMPARE(f.player.previews.size(), 2);
        QCOMPARE(f.player.previews.last(), soundFile(QStringLiteral("work-to-long-rest")));
        QVERIFY(f.player.loops.isEmpty());
        QVERIFY(!f.settings.contains(PomodoroAlarm::soundKey(TransitionKind::LongRestToWork)));
    }

    void loginItemToggle()
    {
        Fixture f;
        SettingsWindow &window = *f.app.settingsWindow();
        f.app.showSettings();
        QVERIFY(window.loginToggle()->isVisibleTo(&window));
        QVERIFY(!window.loginToggle()->isChecked());

        window.loginToggle()->click();
        QCOMPARE(f.login.calls, QList<bool>{true});
        QVERIFY(window.loginToggle()->isChecked());
        window.loginToggle()->click();
        QCOMPARE(f.login.calls, (QList<bool>{true, false}));
        QVERIFY(!window.loginToggle()->isChecked());

        // A refused registration leaves the toggle as the system has it.
        f.login.failure = QStringLiteral("Tokkl could not be added to the login items.");
        window.loginToggle()->click();
        QVERIFY(!window.loginToggle()->isChecked());
        QCOMPARE(window.loginNote()->text(), f.login.failure);

        // Waiting for approval counts as on, with a pointer to System Settings.
        f.login.failure.clear();
        f.login.current = LoginItem::State::RequiresApproval;
        window.close();
        f.app.showSettings();
        QVERIFY(window.loginToggle()->isChecked());
        QVERIFY(window.loginNote()->text().contains(QStringLiteral("Login Items")));
    }
};

QTEST_MAIN(MenuBarAppTest)

#include "menubarapptest.moc"
