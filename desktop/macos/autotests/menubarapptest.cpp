// The menu bar app without its platform layer: the item's text, image and click,
// the menu, the settings window and the client name, driven through the
// core's fake transport, store and clock, a fake menu bar item and a fake
// login item.

#include "connection.h"
#include "connectionsetup.h"
#include "fakes.h"
#include "instanceurl.h"
#include "loginitem.h"
#include "menubarapp.h"
#include "settingswindow.h"
#include "statusimage.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QCheckBox>
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

QByteArray meBody()
{
    return QByteArrayLiteral(
        R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})");
}

QByteArray entryBody(bool running, std::optional<qint64> project = std::nullopt, bool billable = false)
{
    const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), 5},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), project ? QJsonValue(*project) : QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("billable"), billable},
                             {QStringLiteral("start"), startedAt},
                             {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(begin.addSecs(60).toString(Qt::ISODate))},
                             {QStringLiteral("duration"), running ? -begin.toSecsSinceEpoch() : 60},
                             {QStringLiteral("description"), QString()},
                         })
        .toJson(QJsonDocument::Compact);
}

// An entry with everything a resume copies: description, project, task, tags
// and billable flag. It runs from begin, or stopped after seconds.
QByteArray chainEntryBody(qint64 id, const QDateTime &begin, std::optional<qint64> seconds = std::nullopt)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), 11},
                             {QStringLiteral("task_id"), 21},
                             {QStringLiteral("billable"), true},
                             {QStringLiteral("start"), begin.toString(Qt::ISODate)},
                             {QStringLiteral("stop"), seconds ? QJsonValue(begin.addSecs(*seconds).toString(Qt::ISODate)) : QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("duration"), seconds ? *seconds : -begin.toSecsSinceEpoch()},
                             {QStringLiteral("description"), QStringLiteral("Write the report")},
                             {QStringLiteral("tags"), QJsonArray{QStringLiteral("deep"), QStringLiteral("review")}},
                         })
        .toJson(QJsonDocument::Compact);
}

// A new entry without a project, running from begin.
QByteArray newEntryBody(qint64 id, const QDateTime &begin)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("workspace_id"), 7},
                             {QStringLiteral("project_id"), QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("billable"), false},
                             {QStringLiteral("start"), begin.toString(Qt::ISODate)},
                             {QStringLiteral("stop"), QJsonValue(QJsonValue::Null)},
                             {QStringLiteral("duration"), -begin.toSecsSinceEpoch()},
                             {QStringLiteral("description"), QString()},
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

QJsonObject jsonBody(const HttpRequest &request)
{
    return QJsonDocument::fromJson(request.body).object();
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
        }

        QTemporaryDir dir;
        QSettings settings;
        FakeTransport transport;
        HeldCredentialStore store;
        FakeClock clock;
        FakeStatusItem item;
        FakeLoginItem login;
        MenuBarApp app{&transport, &store, &item, &login, &settings, &clock};

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

        // Saved settings for token sign-in, the token in the store, then the
        // answers to /me, the current entry and the projects.
        bool connect(const QByteArray &current, std::optional<qint64> recentProject = std::nullopt)
        {
            store.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), token);
            settings.setValue(SettingsWindow::instanceUrlKey, instance);
            settings.setValue(SettingsWindow::authModeKey, QStringLiteral("token"));
            app.start();
            if (!waitFor("GET", "/me")) {
                return false;
            }
            respond(last("GET", "/me"), 200, meBody());
            if (!waitFor("GET", "/me/time_entries/current") || !waitFor("GET", "/projects")) {
                return false;
            }
            respond(last("GET", "/me/time_entries/current"), 200, current);
            respond(last("GET", "/projects"), 200, projectsBody());
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

        // A click on the running chainEntryBody entry id that began at
        // begin, the server's stop reply and the read after it.
        bool pause(qint64 id, const QDateTime &begin)
        {
            const qsizetype stop = transport.requests.size();
            item.click();
            if (last("PATCH", "/stop") != stop) {
                return false;
            }
            respond(stop, 200, chainEntryBody(id, begin, begin.secsTo(clock.now())));
            if (!waitFor("GET", "/me/time_entries/current", stop)) {
                return false;
            }
            respond(last("GET", "/me/time_entries/current"), 200, QByteArrayLiteral("null"));
            return QTest::qWaitFor([&] {
                return app.timer()->isPaused() && app.timer()->canWrite();
            });
        }

        // Moves the clock one tick per second.
        void advance(int seconds)
        {
            for (int i = 0; i < seconds; ++i) {
                clock.advance(1000);
            }
        }
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
        QVERIFY2(received.contains("\r\nUser-Agent: tokkl-macos/"), received.constData());
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
        QVERIFY(f.connect(entryBody(true)));
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

    // A click on a running timer pauses it: the server stops the entry, the
    // title keeps the total still, and the words say paused.
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
        const HttpRequest stop = f.transport.requests.last();
        QCOMPARE(stop.method, QByteArray("PATCH"));
        QCOMPARE(stop.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5/stop"));
        // The item shows the mutation in flight and ignores another click.
        QCOMPARE(f.item.title, QStringLiteral("0:10 …"));
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);

        f.respond(before, 200, chainEntryBody(5, begin, 600));
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

    // The next click resumes: a new entry that copies the paused one, and the
    // title counts on from the paused total.
    void clickResumesAPausedTimer()
    {
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-600);
        QVERIFY(f.connect(chainEntryBody(5, begin)));
        QVERIFY(f.pause(5, begin));
        // The two minutes paused do not count.
        f.advance(120);
        QCOMPARE(f.item.title, QStringLiteral("0:10"));

        const qsizetype before = f.transport.requests.size();
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest resume = f.transport.requests.last();
        QCOMPARE(resume.method, QByteArray("POST"));
        QCOMPARE(resume.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries"));
        const QJsonObject body = jsonBody(resume);
        QCOMPARE(body.value(QStringLiteral("description")).toString(), QStringLiteral("Write the report"));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("task_id")).toInteger(), 21);
        QCOMPARE(body.value(QStringLiteral("tags")).toArray(), QJsonArray({QStringLiteral("deep"), QStringLiteral("review")}));
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(body.value(QStringLiteral("duration")).toInt(), -1);
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-macos"));

        f.respond(before, 200, chainEntryBody(6, f.clock.now()));
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
        QVERIFY(f.connect(entryBody(true, qint64(11))));
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
        QVERIFY(f.connect(entryBody(true)));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest stop = f.transport.requests.last();
        QCOMPARE(stop.method, QByteArray("PATCH"));
        QCOMPARE(stop.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries/5/stop"));

        f.respond(before, 200, entryBody(false));
        QTRY_VERIFY(!f.app.timer()->isRunning());
        QVERIFY(!f.app.timer()->isPaused());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        QVERIFY(menu.stateAction()->text().startsWith(QStringLiteral("Stopped 0:00")));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Start the Tokkl timer, No project"));
    }

    // Stop Timer while paused ends the chain without a request, and the next
    // click starts a new entry at 0:00.
    void stopTimerEndsAPausedChain()
    {
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-600);
        QVERIFY(f.connect(chainEntryBody(5, begin)));
        QVERIFY(f.pause(5, begin));
        QVERIFY(f.settings.childGroups().contains(QStringLiteral("PauseChain")));
        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));

        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QVERIFY(!f.app.timer()->isPaused());
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        QVERIFY(menu.startStopAction()->isEnabled());
        QVERIFY(menu.stateAction()->text().startsWith(QStringLiteral("Stopped 0:00")));
        QVERIFY2(f.item.accessibleName.startsWith(QStringLiteral("Start the Tokkl timer, ")), qPrintable(f.item.accessibleName));
        QVERIFY(!f.settings.childGroups().contains(QStringLiteral("PauseChain")));
        // The paused dot gives way to the stopped square.
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);

        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest start = f.transport.requests.last();
        QCOMPARE(start.method, QByteArray("POST"));
        QCOMPARE(start.url.path(), QStringLiteral("/api/v9/workspaces/7/time_entries"));
        const QJsonObject body = jsonBody(start);
        QCOMPARE(body.value(QStringLiteral("description")).toString(), QString());
        QVERIFY(!body.contains(QStringLiteral("task_id")));
        f.respond(before, 200, newEntryBody(7, f.clock.now()));
        QTRY_VERIFY(f.app.timer()->isRunning());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:00"));
    }

    void stopTimerEndsAPausedChainOffline_data()
    {
        QTest::addColumn<bool>("rateLimited");
        QTest::newRow("instance unreachable") << false;
        QTest::newRow("rate limited") << true;
    }

    // Ending a paused chain sends nothing, so Stop Timer stays enabled when
    // the poll fails, even while the timer cannot write.
    void stopTimerEndsAPausedChainOffline()
    {
        QFETCH(bool, rateLimited);
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-600);
        QVERIFY(f.connect(chainEntryBody(5, begin)));
        QVERIFY(f.pause(5, begin));
        const qsizetype poll = f.transport.requests.size();
        f.advance(30);
        QCOMPARE(f.last("GET", "/me/time_entries/current"), poll);
        f.transport.respond(poll,
                            rateLimited ? FakeTransport::answer(429, "\"Too many requests\"", "120")
                                        : FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        if (rateLimited) {
            QTRY_VERIFY(!f.app.timer()->canWrite());
        } else {
            QTRY_VERIFY(f.app.timer()->isStale());
        }
        QVERIFY(f.app.timer()->isPaused());
        QVERIFY(!f.app.timer()->isBusy());

        StatusMenu &menu = *f.app.statusMenu();
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Stop Timer"));
        QVERIFY(menu.startStopAction()->isEnabled());

        const qsizetype before = f.transport.requests.size();
        menu.startStopAction()->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QVERIFY(!f.app.timer()->isPaused());
        QVERIFY(!f.settings.childGroups().contains(QStringLiteral("PauseChain")));
        QCOMPARE(menu.startStopAction()->text(), QStringLiteral("Start Timer"));
        // Start sends a request, so it waits for the timer to write again.
        QCOMPARE(menu.startStopAction()->isEnabled(), f.app.timer()->canWrite());
        QCOMPARE(menu.startStopAction()->isEnabled(), !rateLimited);
    }

    // The app keeps the chain in its settings, so quitting and opening it
    // again keeps the paused total.
    void relaunchKeepsThePausedTotal()
    {
        QTemporaryDir dir;
        const QString file = dir.filePath(QStringLiteral("tokkl.ini"));
        const QDateTime begin = FakeClock().now().addSecs(-600);
        {
            Fixture f(file);
            QVERIFY(f.connect(chainEntryBody(5, begin)));
            QVERIFY(f.pause(5, begin));
        }

        Fixture f(file);
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.app.timer()->isPaused());
        QCOMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Resume the Tokkl timer, Alpha"));
        f.item.click();
        const HttpRequest resume = f.transport.requests.last();
        QCOMPARE(resume.method, QByteArray("POST"));
        QCOMPARE(jsonBody(resume).value(QStringLiteral("description")).toString(), QStringLiteral("Write the report"));
    }

    // The running entry's project: a pulsing dot in its colour. Stop Timer
    // leaves a still square.
    void indicatorRunningThenStopped()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(true, qint64(11))));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(f.item.indicator.round);
        QCOMPARE(f.item.indicator.color, QStringLiteral("#06aaf5"));
        QVERIFY(f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, QStringLiteral("Alpha"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, Alpha"));

        f.app.statusMenu()->startStopAction()->trigger();
        f.respond(f.last("PATCH", "/stop"), 200, entryBody(false, qint64(11)));
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
        QVERIFY(f.connect(entryBody(true)));
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Outline);
        QVERIFY(f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, QStringLiteral("No project"));
    }

    void indicatorWhileTheProjectIsRead()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(true, qint64(13))));
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
        QVERIFY(f.connect(entryBody(true, qint64(11))));
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
        QVERIFY(f.connect(entryBody(true, qint64(11))));
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
        f.respond(f.last("PATCH", "/stop"), 200, entryBody(false, qint64(11)));
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
        QVERIFY(f.connect(entryBody(false, qint64(11))));
        const StatusImage before = f.item.image;
        f.app.showSettings();
        SettingsWindow &window = *f.app.settingsWindow();
        QVERIFY(!window.monochromeToggle()->isChecked());
        window.monochromeToggle()->setChecked(true);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(f.item.image.monochromeLogo);
        QCOMPARE(f.item.image.logo, before.logo);
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
    }

    void openAndSettingsActions()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(true)));
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
        QVERIFY(f.connect(entryBody(true)));
        SettingsWindow &window = *f.app.settingsWindow();
        f.app.showSettings();
        QTRY_COMPARE(window.secretField()->text(), token);
        window.secretField()->clear();
        QTest::keyClicks(window.secretField(), QStringLiteral("typed"));
        window.close();
        f.app.showSettings();
        QTRY_COMPARE(window.secretField()->text(), token);
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
