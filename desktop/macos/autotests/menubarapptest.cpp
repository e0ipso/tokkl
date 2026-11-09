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
#include "connectionsettings.h"
#include "pomodoroalarm.h"
#include "soundchoices.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "settingssave.h"
#include "settingswindow.h"
#include "statusimage.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuspresentation.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDir>
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
#include <QSet>
#include <QSettings>
#include <QSignalSpy>
#include <QSpinBox>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTest>

#include <algorithm>
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
    void playOnce(const QString &file) override
    {
        previews.append(file);
    }
    // As NSSound refusing the last sound.
    void fail(const QString &reason)
    {
        reportFailure(reason);
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

// GET /api/app/time_entries/latest: a stopped entry on the project.
QByteArray latestBody(qint64 project)
{
    return QStringLiteral(
               R"({"id":4,"workspace_id":7,"project_id":%1,"billable":false,"start":"2026-10-15T08:00:00Z","stop":"2026-10-15T08:01:00Z",)"
               R"("duration":60,"description":"","tags":[],"project_active":true,"project_billable":false})")
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
}

// A friend of StatusMenu and SettingsWindow, so it reaches their actions and
// fields directly.
// The item of the menu, or the field of the settings window, with the object
// name the app gives it. A missing one fails the test where it is used.
// The app's part of type T, one of its children.
template<typename T>
T *appPart(const MenuBarApp &app)
{
    T *found = app.findChild<T *>(QString(), Qt::FindDirectChildrenOnly);
    if (!found) {
        qWarning("The app has no %s", T::staticMetaObject.className());
    }
    return found;
}

// The settings windows on screen or hidden, as top-level widgets.
QList<SettingsWindow *> settingsWindows()
{
    QList<SettingsWindow *> windows;
    const QWidgetList widgets = QApplication::topLevelWidgets();
    for (QWidget *widget : widgets) {
        if (auto *window = qobject_cast<SettingsWindow *>(widget)) {
            windows.append(window);
        }
    }
    return windows;
}

// The settings window that is not one of earlier.
SettingsWindow *newSettingsWindow(const QList<SettingsWindow *> &earlier)
{
    const QList<SettingsWindow *> windows = settingsWindows();
    for (SettingsWindow *window : windows) {
        if (!earlier.contains(window)) {
            return window;
        }
    }
    qWarning("The app made no settings window");
    return nullptr;
}

template<typename T>
T *part(const StatusMenu &menu, const QByteArray &name)
{
    T *found = menu.menu()->findChild<T *>(QString::fromLatin1(name));
    if (!found) {
        qWarning("The menu has no %s", name.constData());
    }
    return found;
}

template<typename T>
T *part(const StatusMenu *menu, const QByteArray &name)
{
    return part<T>(*menu, name);
}

template<typename T>
T *part(const SettingsWindow &window, const QByteArray &name)
{
    T *found = window.findChild<T *>(QString::fromLatin1(name));
    if (!found) {
        qWarning("The settings window has no %s", name.constData());
    }
    return found;
}

template<typename T>
T *part(const SettingsWindow *window, const QByteArray &name)
{
    return part<T>(*window, name);
}

class MenuBarAppTest : public QObject
{
    Q_OBJECT

    static QAction *projectAction(const StatusMenu &menu, const QString &label)
    {
        const QList<QAction *> actions = part<QMenu>(menu, "project")->actions();
        for (QAction *action : actions) {
            if (action->text() == label) {
                return action;
            }
        }
        return nullptr;
    }

    static QSpinBox *lengthBox(const SettingsWindow &window, PomodoroField field)
    {
        return part<QSpinBox>(window, "length:" + pomodoroPreferenceKey(field).toLatin1());
    }

    static QLabel *lengthError(const SettingsWindow &window, PomodoroField field)
    {
        return part<QLabel>(window, "lengthError:" + pomodoroPreferenceKey(field).toLatin1());
    }

    static QComboBox *soundBox(const SettingsWindow &window, TransitionKind kind)
    {
        return part<QComboBox>(window, "sound:" + transitionKindName(kind).toLatin1());
    }

    static QPushButton *previewButton(const SettingsWindow &window, TransitionKind kind)
    {
        return part<QPushButton>(window, "preview:" + transitionKindName(kind).toLatin1());
    }

    struct Fixture {
        // The settings live in settingsFile, or in a file of the fixture's
        // own when it is empty. The server is a current one.
        explicit Fixture(const QString &settingsFile = QString())
            : settings(settingsFile.isEmpty() ? dir.filePath(QStringLiteral("tokkl.ini")) : settingsFile, QSettings::IniFormat)
        {
            transport.status = FakeTransport::currentStatus();
            // The sounds the bundle would hold in Contents/Resources/sounds.
            appPart<PomodoroAlarm>(app)->setSoundsDirectory(QStringLiteral(TOKKL_SOUNDS_DIR));
        }

        QTemporaryDir dir;
        QSettings settings;
        FakeTransport transport;
        HeldCredentialStore store;
        FakeClock clock;
        FakeStatusItem item;
        FakeLoginItem login;
        FakeAlarmPlayer player;
        // The settings windows of earlier fixtures, so this one's is told
        // apart.
        const QList<SettingsWindow *> earlierWindows = settingsWindows();
        MenuBarApp app{&transport, &store, &item, &login, &player, &settings, &clock};
        // The app's settings window, a top-level widget of its own.
        SettingsWindow *settingsWindow = newSettingsWindow(earlierWindows);

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
            settings.setValue(ConnectionSettings::instanceUrlKey, instance);
            settings.setValue(ConnectionSettings::authModeKey, QStringLiteral("token"));
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
                if (!waitFor("GET", "/app/time_entries/latest")) {
                    return false;
                }
                respond(last("GET", "/app/time_entries/latest"), 200, latestBody(*recentProject));
            }
            return QTest::qWaitFor([&] {
                return appPart<TimerController>(app)->canWrite();
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
            QAction *mode = part<QAction>(appPart<StatusMenu>(app), "pomodoroMode");
            if (mode->isChecked() != on) {
                mode->trigger();
            }
            return appPart<PomodoroSession>(app)->pomodoroMode() == on && mode->isChecked() == on;
        }

        // Start session from the menu, then the server's answer: a session in
        // its first work phase, started now.
        bool startSession()
        {
            const qsizetype before = transport.requests.size();
            part<QAction>(appPart<StatusMenu>(app), "startSession")->trigger();
            const qsizetype post = last("POST", "/app/pomodoro");
            if (post < before) {
                return false;
            }
            respond(post, 200, sessionState(work(clock.now())));
            return appPart<PomodoroSession>(app)->isActive();
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
        QCOMPARE(f.item.menu, appPart<StatusMenu>(f.app)->menu());
        QSignalSpy shown(&f.app, &MenuBarApp::settingsShown);
        f.app.start();
        QCOMPARE(shown.size(), 1);
        QVERIFY(f.settingsWindow->isVisible());
        QVERIFY(f.transport.requests.isEmpty());
        // Nothing to start or stop yet.
        f.item.click();
        QVERIFY(f.transport.requests.isEmpty());
        QVERIFY(!part<QAction>(appPart<StatusMenu>(f.app), "startStop")->isEnabled());
    }

    // The words are keyed on the core's keys: a part, status or click
    // action the core adds without words here fails.
    void everyCoreKeyHasWords()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        const TimerModel &timer = *appPart<TimerController>(f.app);
        const PomodoroSession &session = *appPart<PomodoroSession>(f.app);
        for (const QString &part : statusPartKeys()) {
            QVERIFY2(StatusWords::withPart(part, QStringList(), timer, session).has_value(), qPrintable(part));
        }
        for (const QString &status : timerStatusKeys()) {
            QVERIFY2(!StatusWords::statusWord(status).isEmpty(), qPrintable(status));
        }
        for (const QString &action : primaryActionKeys()) {
            QVERIFY2(!StatusWords::actionName(action, session).isEmpty(), qPrintable(action));
        }
        QVERIFY(!StatusWords::withPart(QStringLiteral("unknown"), QStringList(), timer, session).has_value());
        QVERIFY(StatusWords::statusWord(QStringLiteral("unknown")).isEmpty());
        QVERIFY(StatusWords::actionName(QStringLiteral("unknown"), session).isEmpty());
    }

    void titleShowsElapsedTime()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        QVERIFY(!f.settingsWindow->isVisible());
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
        QVERIFY(part<QAction>(appPart<StatusMenu>(f.app), "state")->text().startsWith(QStringLiteral("Running 0:02")));
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
        QCOMPARE(jsonBody(pause), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        // The item shows the mutation in flight and ignores another click.
        QCOMPARE(f.item.title, QStringLiteral("0:10 …"));
        f.item.click();
        QCOMPARE(f.transport.requests.size(), before + 1);

        f.respond(before, 200, f.state(QByteArrayLiteral("null"), pauseObject(true, 600)));
        QTRY_VERIFY(appPart<TimerController>(f.app)->isPaused());
        QVERIFY(!appPart<TimerController>(f.app)->isRunning());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:10"));
        // The total stands still while paused.
        f.advance(120);
        QCOMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Resume the Tokkl timer, Alpha"));
        QVERIFY2(f.item.toolTip.startsWith(QStringLiteral("Paused 0:10 · Alpha · Connected")), qPrintable(f.item.toolTip));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY2(part<QAction>(menu, "state")->text().startsWith(QStringLiteral("Paused 0:10")), qPrintable(part<QAction>(menu, "state")->text()));
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        QVERIFY(part<QAction>(menu, "startStop")->isEnabled());
        // The paused entry's project and billable flag, locked.
        QCOMPARE(part<QMenu>(menu, "project")->title(), QStringLiteral("Project: Alpha"));
        QVERIFY(!part<QMenu>(menu, "project")->menuAction()->isEnabled());
        QVERIFY(!projectAction(menu, QStringLiteral("Beta (Acme)"))->isEnabled());
        QVERIFY(part<QAction>(menu, "billable")->isChecked());
        QVERIFY(!part<QAction>(menu, "billable")->isEnabled());
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
        QVERIFY(appPart<TimerController>(f.app)->isPaused());
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
        QTRY_VERIFY(appPart<TimerController>(f.app)->isRunning());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:10"));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Pause the Tokkl timer, Alpha"));
        QCOMPARE(part<QAction>(appPart<StatusMenu>(f.app), "startStop")->text(), QStringLiteral("Stop Timer"));
        // The dot pulses again.
        QVERIFY(f.item.indicator.round);
        QVERIFY(f.item.indicator.pulsing);
        f.advance(60);
        QCOMPARE(f.item.title, QStringLiteral("0:11"));
        QVERIFY(part<QAction>(appPart<StatusMenu>(f.app), "state")->text().startsWith(QStringLiteral("Running 0:11")));
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
        const qsizetype start = f.last("POST", "/app/timer/start");
        QVERIFY(start >= 0);
        const QJsonObject body = jsonBody(f.transport.requests.at(start));
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-macos"));
        QCOMPARE(body.value(QStringLiteral("revision")).toInteger(), f.revision);
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
    }

    // Each opening of the menu checks the projects: one read of the catalog
    // revision, and the list only when the revision moved.
    void openingTheMenuChecksTheProjects()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QTRY_VERIFY(!f.transport.catalogRequests.isEmpty());
        const qsizetype checks = f.transport.catalogRequests.size();
        const qsizetype list = f.last("GET", "/projects");

        // As when the system opens the menu.
        Q_EMIT menu.menu()->aboutToShow();
        QTRY_COMPARE(f.transport.catalogRequests.size(), checks + 1);
        QTest::qWait(20);
        QCOMPARE(f.last("GET", "/projects"), list);

        // Beta was renamed on the server.
        f.transport.catalog = FakeTransport::catalogAt(2);
        Q_EMIT menu.menu()->aboutToShow();
        QVERIFY(f.waitFor("GET", "/projects", list));
        QByteArray renamed = projectsBody();
        renamed.replace("\"name\":\"Beta\"", "\"name\":\"Beta renamed\"");
        f.respond(f.last("GET", "/projects"), 200, renamed);
        QTRY_VERIFY(projectAction(menu, QStringLiteral("Beta renamed (Acme)")));
        QVERIFY(!projectAction(menu, QStringLiteral("Beta (Acme)")));
        QCOMPARE(f.transport.catalogRequests.size(), checks + 2);
    }

    // The next start defaults to the last entry's project, a pick while
    // stopped wins, and Billable follows the pick.
    void projectMenuWhileStopped()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(part<QMenu>(menu, "project")->menuAction()->isEnabled());
        QCOMPARE(part<QMenu>(menu, "project")->title(), QStringLiteral("Project: Beta (Acme)"));
        QVERIFY(projectAction(menu, QStringLiteral("Beta (Acme)"))->isChecked());
        QVERIFY(!projectAction(menu, QStringLiteral("Alpha"))->isChecked());
        QVERIFY(!part<QAction>(menu, "billable")->isChecked());

        projectAction(menu, QStringLiteral("Alpha"))->trigger();
        QCOMPARE(appPart<TimerController>(f.app)->chosenProjectId().toLongLong(), 11);
        QTRY_VERIFY(projectAction(menu, QStringLiteral("Alpha"))->isChecked());
        QVERIFY(!projectAction(menu, QStringLiteral("Beta (Acme)"))->isChecked());
        // Alpha is billable by default.
        QVERIFY(part<QAction>(menu, "billable")->isChecked());
        part<QAction>(menu, "billable")->trigger();
        QVERIFY(!appPart<TimerController>(f.app)->chosenBillable());
        QVERIFY(!part<QAction>(menu, "billable")->isChecked());

        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Start Timer"));
        part<QAction>(menu, "startStop")->trigger();
        const QJsonObject body = jsonBody(f.transport.requests.at(f.last("POST", "/app/timer/start")));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(body.value(QStringLiteral("billable")).toBool(), false);
    }

    // While an entry runs the project is locked and billable edits the
    // entry in place.
    void projectMenuWhileRunning()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody(qint64(11))));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!part<QMenu>(menu, "project")->menuAction()->isEnabled());
        QCOMPARE(part<QMenu>(menu, "project")->title(), QStringLiteral("Project: Alpha"));
        QAction *beta = projectAction(menu, QStringLiteral("Beta (Acme)"));
        QVERIFY(beta && !beta->isEnabled());
        QVERIFY(!projectAction(menu, QStringLiteral("No project"))->isEnabled());

        // A pick that reaches the controller anyway is refused.
        const qsizetype before = f.transport.requests.size();
        beta->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QCOMPARE(appPart<TimerController>(f.app)->chosenProjectId().toLongLong(), 11);

        QVERIFY(part<QAction>(menu, "billable")->isEnabled());
        part<QAction>(menu, "billable")->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest update = f.transport.requests.last();
        QCOMPARE(update.method, QByteArray("POST"));
        QCOMPARE(update.url.path(), QStringLiteral("/api/app/timer/edit"));
        QCOMPARE(jsonBody(update).value(QStringLiteral("billable")), QJsonValue(true));
        QVERIFY(jsonBody(update).value(QStringLiteral("entry_id")).isDouble());
        QVERIFY(!jsonBody(update).contains(QStringLiteral("revision")));
        QCOMPARE(jsonBody(update).size(), 2);
    }

    // Stop Timer in the menu stops a running timer and ends the chain.
    void stopTimerStopsARunningTimer()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startStop")->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest stop = f.transport.requests.last();
        QCOMPARE(stop.method, QByteArray("POST"));
        QCOMPARE(stop.url.path(), QStringLiteral("/api/app/timer/stop"));
        QVERIFY(appPart<TimerController>(f.app)->isBusy());

        // The reply is the state that shows the stop.
        f.respond(before, 200, f.state());
        QTRY_VERIFY(!appPart<TimerController>(f.app)->isRunning());
        QVERIFY(!appPart<TimerController>(f.app)->isPaused());
        QTRY_COMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Start Timer"));
        QVERIFY(part<QAction>(menu, "state")->text().startsWith(QStringLiteral("Stopped 0:00")));
        QCOMPARE(f.item.accessibleName, QStringLiteral("Start the Tokkl timer, No project"));
    }

    // Stop Timer while paused discards the chain on the server, and the next
    // click starts a new entry at 0:00.
    void stopTimerEndsAPausedChain()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), std::nullopt, pauseObject(true, 600)));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        QVERIFY(part<QAction>(menu, "startStop")->isEnabled());

        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startStop")->trigger();
        QCOMPARE(f.transport.requests.size(), before + 1);
        const HttpRequest discard = f.transport.requests.last();
        QCOMPARE(discard.method, QByteArray("POST"));
        QCOMPARE(discard.url.path(), QStringLiteral("/api/app/timer/discard"));
        QCOMPARE(discard.body, revisionBody(f.revision));
        // Nothing more to send while the answer is on its way.
        QVERIFY(!part<QAction>(menu, "startStop")->isEnabled());

        f.respond(before, 200, f.state());
        QTRY_VERIFY(!appPart<TimerController>(f.app)->isPaused());
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Start Timer"));
        QTRY_VERIFY(part<QAction>(menu, "startStop")->isEnabled());
        QVERIFY(part<QAction>(menu, "state")->text().startsWith(QStringLiteral("Stopped 0:00")));
        QVERIFY2(f.item.accessibleName.startsWith(QStringLiteral("Start the Tokkl timer, ")), qPrintable(f.item.accessibleName));
        // The paused dot gives way to the stopped square.
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);

        const qsizetype next = f.transport.requests.size();
        f.item.click();
        const qsizetype start = f.last("POST", "/app/timer/start");
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
        QTRY_VERIFY(!appPart<TimerController>(f.app)->canWrite());
        QVERIFY(appPart<TimerController>(f.app)->isPaused());

        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!part<QAction>(menu, "startStop")->isEnabled());
        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startStop")->trigger();
        QCOMPARE(f.transport.requests.size(), before);
        QVERIFY(appPart<TimerController>(f.app)->isPaused());
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
        QTRY_VERIFY(appPart<TimerController>(f.app)->isStale());

        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(part<QAction>(menu, "startStop")->isEnabled());
        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startStop")->trigger();
        QCOMPARE(f.last("POST", "/timer/discard"), before);
        f.transport.respond(before, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(!appPart<TimerController>(f.app)->errorString().isEmpty());
        QVERIFY(appPart<TimerController>(f.app)->isPaused());
        QVERIFY(!part<QAction>(menu, "startStop")->isEnabled());
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
        QTRY_VERIFY(!appPart<TimerController>(f.app)->isRunning());
        QCOMPARE(appPart<TimerController>(f.app)->errorString(), QStringLiteral("The timer changed on another device first."));
        QVERIFY2(f.item.toolTip.contains(QStringLiteral("The timer changed on another device first.")), qPrintable(f.item.toolTip));
        QVERIFY(part<QAction>(appPart<StatusMenu>(f.app), "state")->toolTip().contains(QStringLiteral("The timer changed on another device first.")));
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

        part<QAction>(appPart<StatusMenu>(f.app), "startStop")->trigger();
        f.respond(f.last("POST", "/app/timer/stop"), 200, f.state());
        QTRY_VERIFY(!appPart<TimerController>(f.app)->isRunning());
        QVERIFY(!appPart<TimerController>(f.app)->isPaused());
        QCOMPARE(f.item.indicator.kind, ProjectIndicator::Kind::Filled);
        QVERIFY(!f.item.indicator.round);
        QVERIFY(!f.item.indicator.pulsing);
        QCOMPARE(f.item.indicator.label, StatusWords::projectText(*appPart<TimerController>(f.app)));
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

        QVERIFY(appPart<TimerController>(f.app)->chooseProject(qint64(11)));
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
        QCOMPARE(running.indicator, ProjectIndicator::fromTimer(*appPart<TimerController>(f.app), false));
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

        part<QAction>(appPart<StatusMenu>(f.app), "startStop")->trigger();
        f.respond(f.last("POST", "/app/timer/stop"), 200, f.state());
        QTRY_VERIFY(!appPart<TimerController>(f.app)->isRunning());
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
        SettingsWindow &window = *f.settingsWindow;
        QVERIFY(!part<QCheckBox>(window, "monochrome")->isChecked());
        part<QCheckBox>(window, "monochrome")->setChecked(true);
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
        QVERIFY(part<QCheckBox>(relaunched.settingsWindow, "monochrome")->isChecked());
        relaunched.settings.setValue(SettingsSave::monochromeIconKey, false);
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
        QAction *mode = part<QAction>(appPart<StatusMenu>(f.app), "pomodoroMode");
        QVERIFY(mode->isCheckable());
        QVERIFY(!mode->isChecked());
        QVERIFY(mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode"));
        QVERIFY(!appPart<PomodoroSession>(f.app)->pomodoroMode());

        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.startSession());
        QVERIFY(mode->isChecked());
        QVERIFY(!mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode (locked while running)"));

        part<QAction>(appPart<StatusMenu>(f.app), "endSession")->trigger();
        QVERIFY(appPart<PomodoroSession>(f.app)->isActive());
        f.respond(f.last("POST", "/app/pomodoro/end"), 200, f.state());
        QVERIFY(!appPart<PomodoroSession>(f.app)->isActive());
        QVERIFY(mode->isEnabled());
        QCOMPARE(mode->text(), QStringLiteral("Pomodoro mode"));
        QVERIFY(f.setPomodoroMode(false));

        Fixture running;
        QVERIFY(running.connect(entryBody()));
        QAction *locked = part<QAction>(appPart<StatusMenu>(running.app), "pomodoroMode");
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
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        PomodoroSession &session = *appPart<PomodoroSession>(f.app);
        QVERIFY(part<QAction>(menu, "startStop")->isVisible());
        QVERIFY(!part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "nextPhase")->isVisible());
        QVERIFY(!part<QAction>(menu, "endSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "message")->isVisible());

        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(!part<QAction>(menu, "startStop")->isVisible());
        QVERIFY(!part<QAction>(menu, "startStop")->isEnabled());
        QVERIFY(part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(part<QAction>(menu, "startSession")->isEnabled());
        QCOMPARE(part<QAction>(menu, "startSession")->text(), QStringLiteral("Start session"));
        QVERIFY(!part<QAction>(menu, "nextPhase")->isVisible());
        QVERIFY(!part<QAction>(menu, "endSession")->isVisible());
        QVERIFY(part<QAction>(menu, "state")->text().startsWith(QStringLiteral("Stopped 0:00")));

        // Start session sends the chosen project and billable flag; the
        // server takes the account's lengths.
        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startSession")->trigger();
        QCOMPARE(f.last("POST", "/app/pomodoro"), before);
        const QJsonObject start = f.lastBody("POST", "/app/pomodoro");
        QCOMPARE(start.value(QStringLiteral("project_id")).toInteger(), 12);
        QCOMPARE(start.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-macos"));
        // Another start waits for the answer.
        QVERIFY(!part<QAction>(menu, "startSession")->isEnabled());
        const QDateTime begin = f.clock.now();
        f.respond(before, 200, f.sessionState(work(begin)));
        QVERIFY(session.isActive());
        QVERIFY(!part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "startStop")->isVisible());
        QVERIFY(part<QAction>(menu, "nextPhase")->isVisible());
        QCOMPARE(part<QAction>(menu, "nextPhase")->text(), QStringLiteral("Next phase: Short rest"));
        QVERIFY(part<QAction>(menu, "endSession")->isVisible());
        QCOMPARE(part<QAction>(menu, "endSession")->text(), QStringLiteral("End session"));
        QCOMPARE(part<QAction>(menu, "state")->text(), QStringLiteral("Work · 1:00 left · Pomodoro 1 of 2"));
        // The open pomodoro is the session's: Project and Billable are locked.
        QVERIFY(!part<QMenu>(menu, "project")->menuAction()->isEnabled());
        QVERIFY(!projectAction(menu, QStringLiteral("Alpha"))->isEnabled());
        QVERIFY(!part<QAction>(menu, "billable")->isEnabled());

        // Next phase sends the revision shown.
        f.advance(60);
        part<QAction>(menu, "nextPhase")->trigger();
        QCOMPARE(f.lastBody("POST", "/app/pomodoro/next"), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QCOMPARE(session.phase(), QStringLiteral("shortRest"));
        QCOMPARE(part<QAction>(menu, "nextPhase")->text(), QStringLiteral("Next phase: Work"));
        QCOMPARE(part<QAction>(menu, "state")->text(), QStringLiteral("Short rest · 1:00 left · Pomodoro 1 of 2"));

        // End session ends it on the server. A pomodoro too short to save
        // is dropped and told.
        part<QAction>(menu, "endSession")->trigger();
        QCOMPARE(f.lastBody("POST", "/app/pomodoro/end"), (QJsonObject{{QStringLiteral("revision"), f.revision}}));
        f.respond(f.last("POST", "/app/pomodoro/end"), 200, f.state(QByteArrayLiteral("null"), QJsonValue::Null, QJsonValue::Null, discardedJson(f.clock.now())));
        QVERIFY(!session.isActive());
        QVERIFY(part<QAction>(menu, "message")->isVisible());
        QVERIFY(!part<QAction>(menu, "message")->isEnabled());
        QCOMPARE(part<QAction>(menu, "message")->text(), QStringLiteral("This pomodoro was too short to save."));
        QVERIFY(part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "nextPhase")->isVisible());
        QVERIFY(!part<QAction>(menu, "endSession")->isVisible());
        QVERIFY(part<QAction>(menu, "pomodoroMode")->isEnabled());
    }

    // A session started on another device shows in Timer mode: the state
    // line, the title and the tooltip say so, Next phase and End session are
    // there, the timer toggle is gone and the mode is locked. Ending it
    // elsewhere brings the toggle back.
    void sessionStartedElsewhereShowsInTimerMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null"), qint64(12)));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        PomodoroSession &session = *appPart<PomodoroSession>(f.app);
        QVERIFY(!session.pomodoroMode());
        QVERIFY(part<QAction>(menu, "startStop")->isVisible());

        const QDateTime begin = f.clock.now().addSecs(-10);
        QVERIFY(f.push(f.sessionState(work(begin))));
        QVERIFY(session.isActive());
        QVERIFY(appPart<TimerController>(f.app)->isSessionActive());
        QVERIFY(!session.pomodoroMode());
        QCOMPARE(f.item.title, QStringLiteral("0:50"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · 0:50 left · Pomodoro 1 of 2"));
        QCOMPARE(f.item.accessibleName, f.item.toolTip);
        QCOMPARE(part<QAction>(menu, "state")->text(), f.item.toolTip);
        QVERIFY(!part<QAction>(menu, "startStop")->isVisible());
        QVERIFY(!part<QAction>(menu, "startStop")->isEnabled());
        QVERIFY(!part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(part<QAction>(menu, "nextPhase")->isVisible());
        QCOMPARE(part<QAction>(menu, "nextPhase")->text(), QStringLiteral("Next phase: Short rest"));
        QVERIFY(part<QAction>(menu, "endSession")->isVisible());
        // The mode is locked while the session runs, wherever it began.
        QVERIFY(!part<QAction>(menu, "pomodoroMode")->isChecked());
        QVERIFY(!part<QAction>(menu, "pomodoroMode")->isEnabled());
        QCOMPARE(part<QAction>(menu, "pomodoroMode")->text(), QStringLiteral("Pomodoro mode (locked while running)"));
        QVERIFY(!f.setPomodoroMode(true));

        // The click opens the menu before the planned end and confirms Next
        // phase after it; it starts no timer.
        f.item.click();
        QCOMPARE(f.item.menuPopUps, 1);
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
        f.advance(50);
        QVERIFY(session.isRinging());
        f.item.click();
        QCOMPARE(f.item.menuPopUps, 1);
        QVERIFY(f.last("POST", "/app/pomodoro/next") >= 0);
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QCOMPARE(f.item.title, QStringLiteral("1:00"));
        QCOMPARE(part<QAction>(menu, "nextPhase")->text(), QStringLiteral("Next phase: Work"));

        // The other device ends it.
        QVERIFY(f.push(f.state()));
        QVERIFY(!session.isActive());
        QVERIFY(!part<QAction>(menu, "nextPhase")->isVisible());
        QVERIFY(!part<QAction>(menu, "endSession")->isVisible());
        QVERIFY(part<QAction>(menu, "startStop")->isVisible());
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Start Timer"));
        QTRY_VERIFY(part<QAction>(menu, "startStop")->isEnabled());
        QVERIFY(part<QAction>(menu, "pomodoroMode")->isEnabled());
        QCOMPARE(f.item.title, QStringLiteral("0:00"));
    }

    // A session read at start, in Pomodoro mode, hides Start session too.
    void sessionStartedElsewhereInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.setPomodoroMode(true));
        QVERIFY(f.connect(chainEntryBody(41, f.clock.now()), std::nullopt, QJsonValue::Null, pomodoroJson(work(f.clock.now()), 41)));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(appPart<PomodoroSession>(f.app)->isActive());
        QVERIFY(!part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "startStop")->isVisible());
        QVERIFY(part<QAction>(menu, "nextPhase")->isVisible());
        QVERIFY(part<QAction>(menu, "endSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "pomodoroMode")->isEnabled());
    }

    // Start session is disabled until a state has been read, and while an
    // action waits for its answer.
    void startSessionWaitsForAState()
    {
        Fixture f;
        QVERIFY(f.setPomodoroMode(true));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(part<QAction>(menu, "startSession")->isVisible());
        QVERIFY(!part<QAction>(menu, "startSession")->isEnabled());
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(part<QAction>(menu, "startSession")->isEnabled());
    }

    // A refused action leaves its message under the state line; the next
    // action clears it.
    void sessionActionFailureShowsItsMessage()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        const qsizetype before = f.transport.requests.size();
        part<QAction>(menu, "startSession")->trigger();
        QCOMPARE(f.last("POST", "/app/pomodoro"), before);
        f.respond(before, 422, QByteArrayLiteral("\"No such project\""));
        QTRY_VERIFY(!appPart<PomodoroSession>(f.app)->message().isEmpty());
        QVERIFY(!appPart<PomodoroSession>(f.app)->isActive());
        QVERIFY(part<QAction>(menu, "message")->isVisible());
        QCOMPARE(part<QAction>(menu, "message")->text(), appPart<PomodoroSession>(f.app)->message());
        QTRY_VERIFY(part<QAction>(menu, "startSession")->isEnabled());
    }

    // The session keeps counting from the last state held when the instance
    // cannot be reached, and the words and the title say it is offline.
    void sessionWhileOffline()
    {
        Fixture f;
        QVERIFY(f.connect(chainEntryBody(41, f.clock.now()), std::nullopt, QJsonValue::Null, pomodoroJson(work(f.clock.now()), 41)));
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QCOMPARE(f.item.title, QStringLiteral("1:00"));

        const qsizetype poll = f.transport.requests.size();
        f.advance(30);
        QCOMPARE(f.last("GET", "/app/timer"), poll);
        f.transport.respond(poll, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(appPart<TimerController>(f.app)->isStale());
        QCOMPARE(f.item.title, QStringLiteral("0:30 !"));
        QCOMPARE(f.item.toolTip, QStringLiteral("Work · 0:30 left · Pomodoro 1 of 2 · Offline, showing the last known state"));
        QCOMPARE(part<QAction>(menu, "state")->text(), f.item.toolTip);
        // The name for a screen reader stays short.
        QCOMPARE(f.item.accessibleName, QStringLiteral("Work · 0:30 left · Pomodoro 1 of 2"));

        // Next phase still tries; when the request fails the menu says why.
        part<QAction>(menu, "nextPhase")->trigger();
        const qsizetype next = f.last("POST", "/app/pomodoro/next");
        QVERIFY(next > poll);
        f.transport.respond(next, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QTRY_VERIFY(!appPart<PomodoroSession>(f.app)->message().isEmpty());
        QVERIFY(part<QAction>(menu, "message")->isVisible());
        QCOMPARE(part<QAction>(menu, "message")->text(), appPart<PomodoroSession>(f.app)->message());
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
        QCOMPARE(part<QAction>(appPart<StatusMenu>(f.app), "state")->text(), f.item.toolTip);
    }

    // A primary click in Pomodoro mode starts a session, opens the menu in
    // mid-phase and confirms Next phase while the alarm rings.
    void clickInPomodoroMode()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        QVERIFY(f.setPomodoroMode(true));
        PomodoroSession &session = *appPart<PomodoroSession>(f.app);

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
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(part<QAction>(menu, "startStop")->isVisible());
        QCOMPARE(part<QAction>(menu, "startStop")->text(), QStringLiteral("Stop Timer"));
        QVERIFY(!part<QAction>(menu, "startSession")->isVisible());

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
        QVERIFY(appPart<PomodoroSession>(f.app)->isRinging());
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
        QVERIFY(appPart<PomodoroSession>(f.app)->isRinging());
        QCOMPARE(appPart<PomodoroSession>(f.app)->ringingTransition(), QStringLiteral("workToShortRest"));
        QCOMPARE(f.player.looping, soundFile(QStringLiteral("work-to-short-rest")));
        // Ticks past the end change nothing: the same file keeps looping.
        f.advance(5);
        QCOMPARE(f.player.loops.size(), 1);

        QVERIFY(part<QAction>(appPart<StatusMenu>(f.app), "nextPhase")->isEnabled());
        part<QAction>(appPart<StatusMenu>(f.app), "nextPhase")->trigger();
        f.respond(f.last("POST", "/app/pomodoro/next"), 200, f.sessionState(shortRest(f.clock.now(), begin)));
        QVERIFY(!appPart<PomodoroSession>(f.app)->isRinging());
        QVERIFY(f.player.looping.isEmpty());
        QCOMPARE(f.player.stops, 1);

        // The short rest ends with the sound chosen for it.
        f.settings.setValue(MenuBarApp::soundKey(TransitionKind::ShortRestToWork), QStringLiteral("long-rest-to-work"));
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
        QVERIFY(appPart<PomodoroSession>(relaunched.app)->pomodoroMode());
        QVERIFY(part<QAction>(appPart<StatusMenu>(relaunched.app), "pomodoroMode")->isChecked());
        QVERIFY(!relaunched.item.image.hourglass.isEmpty());
        QVERIFY(appPart<PomodoroPreferences>(relaunched.app));
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

        f.settings.setValue(SettingsSave::monochromeIconKey, true);
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
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QSignalSpy open(&f.app, &MenuBarApp::openUrlRequested);
        part<QAction>(menu, "open")->trigger();
        QCOMPARE(open.size(), 1);
        QCOMPARE(open.first().first().toUrl(), QUrl(QStringLiteral("https://a.example.test/")));
        QSignalSpy quit(&f.app, &MenuBarApp::quitRequested);
        part<QAction>(menu, "quit")->trigger();
        QCOMPARE(quit.size(), 1);
        part<QAction>(menu, "settings")->trigger();
        QVERIFY(f.settingsWindow->isVisible());
    }

    // Save keeps the address, method and email in the settings and the token
    // in the store only; the connection picks them up.
    void settingsSaveToken()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        QVERIFY(part<QRadioButton>(window, "token")->isChecked());
        QVERIFY(!part<QLineEdit>(window, "email")->isVisibleTo(&window));
        part<QLineEdit>(window, "url")->setText(QStringLiteral("  https://a.example.test/tokkl/  "));
        QTest::keyClicks(part<QLineEdit>(window, "secret"), token);
        QVERIFY(part<QPushButton>(window, "test")->isEnabled());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);

        QCOMPARE(f.settings.value(ConnectionSettings::instanceUrlKey).toString(), QStringLiteral("https://a.example.test/tokkl"));
        QCOMPARE(f.settings.value(ConnectionSettings::authModeKey).toString(), QStringLiteral("token"));
        const QString key = credentialKey(parseInstanceUrl(QStringLiteral("https://a.example.test/tokkl")), AuthMode::Token, QString());
        QCOMPARE(f.store.secrets.value(key), token);
        QCOMPARE(appPart<Connection>(f.app)->instanceUrl(), QStringLiteral("https://a.example.test/tokkl"));

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
        SettingsWindow &window = *f.settingsWindow;
        QVERIFY(window.isVisible());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        part<QLineEdit>(window, "url")->setText(instance);
        QTest::keyClicks(part<QLineEdit>(window, "secret"), token);
        part<QCheckBox>(window, "monochrome")->setChecked(true);
        part<QPushButton>(window, "save")->click();

        QTRY_COMPARE(f.store.held.size(), 1);
        QCoreApplication::processEvents();
        QCOMPARE(saved.count(), 0);
        QVERIFY(window.isVisible());
        QVERIFY(!part<QPushButton>(window, "save")->isEnabled());
        QVERIFY(!f.settings.contains(ConnectionSettings::instanceUrlKey));
        QVERIFY(!f.settings.contains(SettingsSave::monochromeIconKey));
        // The pending save owns a snapshot, even if the checkbox changes.
        part<QCheckBox>(window, "monochrome")->setChecked(false);
        QVERIFY(appPart<Connection>(f.app)->instanceUrl().isEmpty());

        f.store.finish(CredentialResult::Status::Ok);
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(!window.isVisible());
        QCOMPARE(f.settings.value(ConnectionSettings::instanceUrlKey).toString(), instance);
        QCOMPARE(f.store.secrets.value(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString())), token);
        QCOMPARE(appPart<Connection>(f.app)->instanceUrl(), instance);
        QVERIFY(f.settings.value(SettingsSave::monochromeIconKey).toBool());
        QVERIFY(f.item.image.monochromeLogo);
    }

    // A failed write keeps the window open with the typed secret and the
    // store's error, and changes no setting. Save works again afterwards.
    void settingsStayOpenWhenTheStoreFails()
    {
        Fixture f;
        f.store.hold = true;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        QSignalSpy saved(&window, &SettingsWindow::saved);
        part<QLineEdit>(window, "url")->setText(instance);
        QTest::keyClicks(part<QLineEdit>(window, "secret"), token);
        part<QCheckBox>(window, "monochrome")->setChecked(true);
        part<QPushButton>(window, "save")->click();
        QTRY_COMPARE(f.store.held.size(), 1);

        f.store.finish(CredentialResult::Status::Unavailable);
        QTRY_VERIFY(part<QLabel>(window, "storeError")->isVisibleTo(&window));
        QCOMPARE(part<QLabel>(window, "storeError")->text(), f.store.message(CredentialResult{CredentialResult::Status::Unavailable, {}}));
        QCOMPARE(saved.count(), 0);
        QVERIFY(window.isVisible());
        QCOMPARE(part<QLineEdit>(window, "secret")->text(), token);
        QVERIFY(part<QPushButton>(window, "save")->isEnabled());
        QVERIFY(!f.settings.contains(ConnectionSettings::instanceUrlKey));
        QVERIFY(!f.settings.contains(SettingsSave::monochromeIconKey));
        QVERIFY(!f.item.image.monochromeLogo);
        QVERIFY(f.store.secrets.isEmpty());

        part<QPushButton>(window, "save")->click();
        QTRY_COMPARE(f.store.held.size(), 1);
        QVERIFY(!part<QLabel>(window, "storeError")->isVisibleTo(&window));
        f.store.finish(CredentialResult::Status::Ok);
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(!window.isVisible());
        QCOMPARE(f.settings.value(ConnectionSettings::instanceUrlKey).toString(), instance);
    }

    // A settings file that cannot be written keeps the window open and says
    // so: saved() does not come, and no setting changes, not even in memory.
    void settingsStayOpenWhenTheFileCannotBeWritten()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        QVERIFY(window.isVisible());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        part<QLineEdit>(window, "url")->setText(instance);
        QTest::keyClicks(part<QLineEdit>(window, "secret"), token);
        part<QCheckBox>(window, "monochrome")->setChecked(true);
        // A directory stands where the file would go.
        QFile::remove(f.settings.fileName());
        QVERIFY(QDir().mkpath(f.settings.fileName()));
        QVERIFY(!part<QLabel>(window, "saveError")->isVisibleTo(&window));

        part<QPushButton>(window, "save")->click();
        QTRY_VERIFY(part<QLabel>(window, "saveError")->isVisibleTo(&window));
        QVERIFY(part<QLabel>(window, "saveError")->text().contains(f.settings.fileName()));
        QCOMPARE(saved.count(), 0);
        QVERIFY(window.isVisible());
        QVERIFY(part<QPushButton>(window, "save")->isEnabled());
        QCOMPARE(part<QLineEdit>(window, "secret")->text(), token);
        QVERIFY(!f.settings.contains(ConnectionSettings::instanceUrlKey));
        QVERIFY(!f.settings.contains(SettingsSave::monochromeIconKey));
        QVERIFY(appPart<Connection>(f.app)->instanceUrl().isEmpty());
        QVERIFY(!f.item.image.monochromeLogo);

        // Opening the window again forgets the failure, and once the file
        // can be written a save works.
        window.close();
        f.app.showSettings();
        QVERIFY(!part<QLabel>(window, "saveError")->isVisibleTo(&window));
        QVERIFY(QDir(f.settings.fileName()).removeRecursively());
        part<QLineEdit>(window, "url")->setText(instance);
        // The Keychain kept the secret the first time.
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        part<QPushButton>(window, "save")->click();
        QTRY_COMPARE(saved.count(), 1);
        QTRY_VERIFY(!window.isVisible());
        QVERIFY(!part<QLabel>(window, "saveError")->isVisibleTo(&window));
        QCOMPARE(f.settings.value(ConnectionSettings::instanceUrlKey).toString(), instance);
        QCOMPARE(appPart<Connection>(f.app)->instanceUrl(), instance);
    }

    void settingsRefuseCredentialsInTheAddress()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        part<QLineEdit>(window, "url")->setText(QStringLiteral("https://bea:secret@a.example.test"));
        QVERIFY(part<QLabel>(window, "urlNote")->isVisibleTo(&window));
        QVERIFY(!window.save());
        QVERIFY(!f.settings.contains(ConnectionSettings::instanceUrlKey));
    }

    void settingsPasswordAndTestConnection()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        part<QLineEdit>(window, "url")->setText(instance);
        part<QRadioButton>(window, "password")->setChecked(true);
        QVERIFY(part<QLineEdit>(window, "email")->isVisibleTo(&window));
        part<QLineEdit>(window, "email")->setText(QStringLiteral("bea@example.test"));
        QTest::keyClicks(part<QLineEdit>(window, "secret"), QStringLiteral("pw-1"));
        QVERIFY(part<QPushButton>(window, "test")->isEnabled());

        part<QPushButton>(window, "test")->click();
        const qsizetype test = f.last("GET", "/me");
        QVERIFY(test >= 0);
        QCOMPARE(f.transport.requests.at(test).authorization, QByteArray("Basic ") + QByteArray("bea@example.test:pw-1").toBase64());
        QCOMPARE(part<QLabel>(window, "testResult")->text(), QStringLiteral("Testing…"));
        f.respond(test, 200, meBody());
        QCOMPARE(window.findChild<ConnectionSetup *>()->testResult(), ConnectionSetup::Succeeded);
        QVERIFY2(part<QLabel>(window, "testResult")->text().contains(QStringLiteral("Connected as Bea")), qPrintable(part<QLabel>(window, "testResult")->text()));

        part<QPushButton>(window, "test")->click();
        f.respond(f.last("GET", "/me"), 401, QByteArrayLiteral(R"({"error":"bad"})"));
        QCOMPARE(window.findChild<ConnectionSetup *>()->testResult(), ConnectionSetup::Failed);
        QVERIFY(part<QLabel>(window, "testResult")->text().contains(QStringLiteral("refused")));

        // Nothing is kept before Save.
        QVERIFY(f.store.secrets.isEmpty());
        QSignalSpy saved(&window, &SettingsWindow::saved);
        QVERIFY(window.save());
        QTRY_COMPARE(saved.count(), 1);
        QCOMPARE(f.settings.value(ConnectionSettings::authModeKey).toString(), QStringLiteral("password"));
        QCOMPARE(f.settings.value(ConnectionSettings::emailKey).toString(), QStringLiteral("bea@example.test"));
        QCOMPARE(f.store.secrets.size(), 1);
    }

    // A secret typed and not saved is gone when the window opens again; the
    // stored one comes back.
    void settingsReopenDropsUnsavedSecret()
    {
        Fixture f;
        QVERIFY(f.connect(entryBody()));
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        part<QLineEdit>(window, "secret")->clear();
        QTest::keyClicks(part<QLineEdit>(window, "secret"), QStringLiteral("typed"));
        window.close();
        f.app.showSettings();
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
    }

    // Opening the window reads the lengths again, and the spin boxes take
    // the server's values inside the shared ranges.
    void pomodoroSettingsLoadTheLengths()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.settingsWindow;
        const qsizetype before = f.transport.requests.size();
        f.app.showSettings();
        QVERIFY(f.waitFor("GET", "/me/preferences", before - 1));
        f.respond(f.last("GET", "/me/preferences"), 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":30,"pomodoro_break_interval_in_minutes":7,)"
            R"("pomodoro_long_break_interval_in_minutes":20,"pomodoro_long_break_every":3})"));

        QTRY_COMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 30);
        QCOMPARE(lengthBox(window, PomodoroField::ShortRestMinutes)->value(), 7);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->value(), 20);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestEvery)->value(), 3);
        for (const PomodoroField field : {PomodoroField::WorkMinutes, PomodoroField::ShortRestMinutes, PomodoroField::LongRestMinutes, PomodoroField::LongRestEvery}) {
            QVERIFY(!lengthBox(window, field)->isReadOnly());
            QVERIFY(!lengthError(window, field)->isVisibleTo(&window));
        }
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->minimum(), 1);
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->maximum(), 180);
        QCOMPARE(lengthBox(window, PomodoroField::ShortRestMinutes)->minimum(), 1);
        QCOMPARE(lengthBox(window, PomodoroField::ShortRestMinutes)->maximum(), 60);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->minimum(), 1);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->maximum(), 60);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestEvery)->minimum(), 1);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestEvery)->maximum(), 12);
        QVERIFY(!part<QLabel>(window, "lengthsNote")->isVisibleTo(&window));
    }

    // Save posts the lengths that changed, and only those, next to the
    // Keychain write, and the window closes once both are done.
    void pomodoroSettingsSavePostsTheChangedLengths()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        QVERIFY(f.waitFor("GET", "/me/preferences", qsizetype(f.transport.requests.size()) - 2));
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        QTRY_COMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 1);

        lengthBox(window, PomodoroField::WorkMinutes)->setValue(30);
        lengthBox(window, PomodoroField::LongRestEvery)->setValue(3);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        const qsizetype before = f.transport.requests.size();
        part<QPushButton>(window, "save")->click();
        const qsizetype post = f.last("POST", "/me/preferences");
        QVERIFY(post >= before);
        QCOMPARE(jsonBody(f.transport.requests.at(post)),
                 (QJsonObject{{QStringLiteral("pomodoro_focus_interval_in_minutes"), 30}, {QStringLiteral("pomodoro_long_break_every"), 3}}));
        // The Keychain has the secret; the window waits for the server.
        QTRY_COMPARE(saved.count(), 1);
        QVERIFY(window.isVisible());
        QVERIFY(!part<QPushButton>(window, "save")->isEnabled());

        f.respond(post, 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":30,"pomodoro_break_interval_in_minutes":1,)"
            R"("pomodoro_long_break_interval_in_minutes":1,"pomodoro_long_break_every":3})"));
        QTRY_VERIFY(!window.isVisible());
        QCOMPARE(appPart<PomodoroPreferences>(f.app)->workMinutes(), 30);
        QVERIFY(part<QPushButton>(window, "save")->isEnabled());

        // Nothing changed: Save posts no lengths and closes once the
        // Keychain has the secret.
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        const qsizetype again = f.transport.requests.size();
        part<QPushButton>(window, "save")->click();
        QTRY_VERIFY(!window.isVisible());
        QCOMPARE(f.find("POST", "/me/preferences").size(), 1);
        QVERIFY(f.transport.requests.size() >= again);
    }

    // Lengths read again while the window is open fill only the fields the
    // user left alone, and Save posts the edit against what was read.
    void pomodoroSettingsKeepEditedLengthsThroughARead()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        QTRY_COMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 1);

        lengthBox(window, PomodoroField::WorkMinutes)->setValue(30);
        // The lengths changed on another device, and are read again.
        const qsizetype before = f.transport.requests.size();
        appPart<PomodoroPreferences>(f.app)->refresh();
        QVERIFY(f.waitFor("GET", "/me/preferences", before - 1));
        f.respond(f.last("GET", "/me/preferences"), 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":40,"pomodoro_break_interval_in_minutes":8,)"
            R"("pomodoro_long_break_interval_in_minutes":1,"pomodoro_long_break_every":2})"));
        QTRY_COMPARE(lengthBox(window, PomodoroField::ShortRestMinutes)->value(), 8);
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 30);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->value(), 1);

        part<QPushButton>(window, "save")->click();
        const qsizetype post = f.last("POST", "/me/preferences");
        QVERIFY(post >= before);
        QCOMPARE(jsonBody(f.transport.requests.at(post)), (QJsonObject{{QStringLiteral("pomodoro_focus_interval_in_minutes"), 30}}));

        // Opening the window again shows what the server holds.
        f.respond(post, 200, QByteArrayLiteral(
            R"({"pomodoro_focus_interval_in_minutes":30,"pomodoro_break_interval_in_minutes":8,)"
            R"("pomodoro_long_break_interval_in_minutes":1,"pomodoro_long_break_every":2})"));
        QTRY_VERIFY(!window.isVisible());
        lengthBox(window, PomodoroField::LongRestMinutes)->setValue(9);
        f.app.showSettings();
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->value(), 1);
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 30);
    }

    // Lengths edited while the window moves to another account are not
    // posted: they would change the account the save leaves.
    void pomodoroSettingsPostNoLengthsWhenTheAccountChanges()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);
        QTRY_COMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 1);

        lengthBox(window, PomodoroField::WorkMinutes)->setValue(30);
        const QString other = QStringLiteral("https://b.example.test");
        part<QLineEdit>(window, "url")->setText(other);
        // The secret shown belonged to the account before.
        QTRY_VERIFY(part<QLineEdit>(window, "secret")->text().isEmpty());
        QTest::keyClicks(part<QLineEdit>(window, "secret"), QStringLiteral("tok-b"));
        QSignalSpy saved(&window, &SettingsWindow::saved);
        part<QPushButton>(window, "save")->click();
        QTRY_COMPARE(saved.count(), 1);
        QTRY_VERIFY(!window.isVisible());
        QVERIFY(f.find("POST", "/me/preferences").isEmpty());
        QCOMPARE(f.settings.value(ConnectionSettings::instanceUrlKey).toString(), other);
        QCOMPARE(appPart<Connection>(f.app)->instanceUrl(), other);
    }

    // A 400 that names a key shows next to its field, the window stays
    // open and Save works again.
    void pomodoroSettingsShowARefusedLengthNextToItsField()
    {
        Fixture f;
        QVERIFY(f.connect(QByteArrayLiteral("null")));
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        f.respond(f.last("GET", "/me/preferences"), 200, preferencesBody());
        QTRY_COMPARE(part<QLineEdit>(window, "secret")->text(), token);

        lengthBox(window, PomodoroField::LongRestMinutes)->setValue(45);
        part<QPushButton>(window, "save")->click();
        const qsizetype post = f.last("POST", "/me/preferences");
        QVERIFY(post >= 0);
        HttpResponse refusal = FakeTransport::answer(400, QByteArrayLiteral(R"("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60")"));
        refusal.errorField = "pomodoro_long_break_interval_in_minutes";
        f.transport.respond(post, refusal);
        QTRY_VERIFY(lengthError(window, PomodoroField::LongRestMinutes)->isVisibleTo(&window));
        QCOMPARE(lengthError(window, PomodoroField::LongRestMinutes)->text(),
                 QStringLiteral("Invalid pomodoro_long_break_interval_in_minutes: expected an integer from 1 to 60"));
        QVERIFY(!lengthError(window, PomodoroField::WorkMinutes)->isVisibleTo(&window));
        QVERIFY(!part<QLabel>(window, "pomodoroError")->isVisibleTo(&window));
        QVERIFY(window.isVisible());
        QVERIFY(part<QPushButton>(window, "save")->isEnabled());
        // The typed value stays for another try.
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->value(), 45);

        // A failure that names no field is the general error.
        part<QPushButton>(window, "save")->click();
        f.respond(f.last("POST", "/me/preferences"), 400, QByteArrayLiteral(R"("Preferences are too large")"));
        QTRY_VERIFY(part<QLabel>(window, "pomodoroError")->isVisibleTo(&window));
        QCOMPARE(part<QLabel>(window, "pomodoroError")->text(), QStringLiteral("Preferences are too large"));
        QVERIFY(!lengthError(window, PomodoroField::LongRestMinutes)->isVisibleTo(&window));
        QVERIFY(window.isVisible());
    }

    // Without a validated account the lengths show as last read, cannot be
    // edited, and a note says why.
    void pomodoroSettingsAreReadOnlyWithoutAnAccount()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        QVERIFY(window.isVisible());
        QVERIFY(f.transport.requests.isEmpty());
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->value(), 25);
        QCOMPARE(lengthBox(window, PomodoroField::ShortRestMinutes)->value(), 5);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestMinutes)->value(), 15);
        QCOMPARE(lengthBox(window, PomodoroField::LongRestEvery)->value(), 4);
        for (const PomodoroField field : {PomodoroField::WorkMinutes, PomodoroField::ShortRestMinutes, PomodoroField::LongRestMinutes, PomodoroField::LongRestEvery}) {
            QVERIFY(lengthBox(window, field)->isReadOnly());
        }
        QVERIFY(part<QLabel>(window, "lengthsNote")->isVisibleTo(&window));
        QVERIFY(part<QLabel>(window, "lengthsNote")->text().contains(QStringLiteral("connection")));
        QVERIFY(!part<QLabel>(window, "pomodoroError")->isVisibleTo(&window));
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
        SettingsWindow &window = *f.settingsWindow;
        QComboBox *box = soundBox(window, TransitionKind::WorkToShortRest);
        QCOMPARE(box->count(), 4);
        for (int i = 0; i < 4; ++i) {
            QCOMPARE(box->itemText(i), sounds.at(i).label);
        }
        QCOMPARE(box->currentIndex(), 0);
        QCOMPARE(soundBox(window, TransitionKind::ShortRestToWork)->currentIndex(), 1);
        QCOMPARE(soundBox(window, TransitionKind::WorkToLongRest)->currentIndex(), 2);
        QCOMPARE(soundBox(window, TransitionKind::LongRestToWork)->currentIndex(), 3);

        box->setCurrentIndex(3);
        QVERIFY(!f.settings.contains(MenuBarApp::soundKey(TransitionKind::WorkToShortRest)));
        part<QLineEdit>(window, "url")->setText(instance);
        QTest::keyClicks(part<QLineEdit>(window, "secret"), token);
        QSignalSpy saved(&window, &SettingsWindow::saved);
        part<QPushButton>(window, "save")->click();
        QTRY_COMPARE(saved.count(), 1);
        QCOMPARE(f.settings.value(MenuBarApp::soundKey(TransitionKind::WorkToShortRest)).toString(), QStringLiteral("long-rest-to-work"));
        // The untouched choices are kept as they showed.
        QCOMPARE(f.settings.value(MenuBarApp::soundKey(TransitionKind::ShortRestToWork)).toString(), QStringLiteral("short-rest-to-work"));
        QCOMPARE(appPart<SoundChoices>(f.app)->chosen(TransitionKind::WorkToShortRest), QStringLiteral("long-rest-to-work"));
        QCOMPARE(appPart<SoundChoices>(f.app)->chosen(TransitionKind::ShortRestToWork), QStringLiteral("short-rest-to-work"));

        Fixture relaunched(f.settings.fileName());
        relaunched.app.showSettings();
        QCOMPARE(soundBox(*relaunched.settingsWindow, TransitionKind::WorkToShortRest)->currentIndex(), 3);
        QCOMPARE(soundBox(*relaunched.settingsWindow, TransitionKind::LongRestToWork)->currentIndex(), 3);
    }

    // Preview plays the sound selected next to it once, through the player,
    // without saving.
    void previewPlaysTheSelectedSound()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        soundBox(window, TransitionKind::LongRestToWork)->setCurrentIndex(1);
        previewButton(window, TransitionKind::LongRestToWork)->click();
        QCOMPARE(f.player.previews, QStringList{soundFile(QStringLiteral("short-rest-to-work"))});
        previewButton(window, TransitionKind::WorkToLongRest)->click();
        QCOMPARE(f.player.previews.size(), 2);
        QCOMPARE(f.player.previews.last(), soundFile(QStringLiteral("work-to-long-rest")));
        QVERIFY(f.player.loops.isEmpty());
        QVERIFY(!f.settings.contains(MenuBarApp::soundKey(TransitionKind::LongRestToWork)));
    }

    // A sound that did not play says why under the sounds and in the
    // menu, until the next one starts.
    void aSilentAlarmSaysWhy()
    {
        Fixture f;
        f.app.start();
        SettingsWindow &window = *f.settingsWindow;
        StatusMenu &menu = *appPart<StatusMenu>(f.app);
        QVERIFY(part<QLabel>(window, "soundError")->isHidden());
        QVERIFY(!part<QAction>(menu, "message")->isVisible());

        previewButton(window, TransitionKind::LongRestToWork)->click();
        f.player.fail(QStringLiteral("pomodoro-long-rest-to-work.wav does not play"));
        const QString expected = QStringLiteral("No alarm sound: pomodoro-long-rest-to-work.wav does not play");
        QCOMPARE(part<QLabel>(window, "soundError")->text(), expected);
        QVERIFY(!part<QLabel>(window, "soundError")->isHidden());
        QCOMPARE(part<QAction>(menu, "message")->text(), expected);
        QVERIFY(part<QAction>(menu, "message")->isVisible());

        previewButton(window, TransitionKind::LongRestToWork)->click();
        QVERIFY(part<QLabel>(window, "soundError")->isHidden());
        QVERIFY(!part<QAction>(menu, "message")->isVisible());
    }

    // Each sound selector has its label as buddy and a name for its
    // transition, and each Preview button a name of its own. Long rest
    // every reads 1 pomodoro, 2 pomodoros and so on.
    void pomodoroControlsAreNamed()
    {
        Fixture f;
        SettingsWindow &window = *f.settingsWindow;
        const QList<QLabel *> labels = window.findChildren<QLabel *>();
        QSet<QString> previewNames;
        const std::array<TransitionKind, 4> kinds{TransitionKind::WorkToShortRest, TransitionKind::ShortRestToWork, TransitionKind::WorkToLongRest,
                                                  TransitionKind::LongRestToWork};
        for (const TransitionKind kind : kinds) {
            QComboBox *box = soundBox(window, kind);
            QVERIFY(!box->accessibleName().isEmpty());
            const auto buddy = std::find_if(labels.cbegin(), labels.cend(), [box](const QLabel *label) {
                return label->buddy() == box;
            });
            QVERIFY(buddy != labels.cend());
            QVERIFY((*buddy)->text().endsWith(QLatin1Char(':')));
            QPushButton *preview = previewButton(window, kind);
            QCOMPARE(preview->text(), QStringLiteral("Preview"));
            previewNames.insert(preview->accessibleName());
        }
        QCOMPARE(soundBox(window, TransitionKind::WorkToShortRest)->accessibleName(), QStringLiteral("Work to short rest sound"));
        QCOMPARE(previewButton(window, TransitionKind::LongRestToWork)->accessibleName(), QStringLiteral("Preview the long rest to work sound"));
        QCOMPARE(previewNames.size(), 4);

        QSpinBox *every = lengthBox(window, PomodoroField::LongRestEvery);
        every->setValue(4);
        QCOMPARE(every->text(), QStringLiteral("4 pomodoros"));
        every->setValue(1);
        QCOMPARE(every->text(), QStringLiteral("1 pomodoro"));
        every->setValue(2);
        QCOMPARE(every->text(), QStringLiteral("2 pomodoros"));
        QCOMPARE(lengthBox(window, PomodoroField::WorkMinutes)->suffix(), QStringLiteral(" min"));

        // Typing a count keeps working with the words around it. The boxes
        // stay read-only until the lengths are read, which this test skips.
        every->setReadOnly(false);
        QLineEdit *edit = every->findChild<QLineEdit *>();
        QVERIFY(edit);
        edit->selectAll();
        QTest::keyClicks(edit, QStringLiteral("3"));
        every->interpretText();
        QCOMPARE(every->value(), 3);
        QCOMPARE(every->text(), QStringLiteral("3 pomodoros"));
    }

    void loginItemToggle()
    {
        Fixture f;
        SettingsWindow &window = *f.settingsWindow;
        f.app.showSettings();
        QVERIFY(part<QCheckBox>(window, "login")->isVisibleTo(&window));
        QVERIFY(!part<QCheckBox>(window, "login")->isChecked());

        part<QCheckBox>(window, "login")->click();
        QCOMPARE(f.login.calls, QList<bool>{true});
        QVERIFY(part<QCheckBox>(window, "login")->isChecked());
        part<QCheckBox>(window, "login")->click();
        QCOMPARE(f.login.calls, (QList<bool>{true, false}));
        QVERIFY(!part<QCheckBox>(window, "login")->isChecked());

        // A refused registration leaves the toggle as the system has it.
        f.login.failure = QStringLiteral("Tokkl could not be added to the login items.");
        part<QCheckBox>(window, "login")->click();
        QVERIFY(!part<QCheckBox>(window, "login")->isChecked());
        QCOMPARE(part<QLabel>(window, "loginNote")->text(), f.login.failure);

        // Waiting for approval counts as on, with a pointer to System Settings.
        f.login.failure.clear();
        f.login.current = LoginItem::State::RequiresApproval;
        window.close();
        f.app.showSettings();
        QVERIFY(part<QCheckBox>(window, "login")->isChecked());
        QVERIFY(part<QLabel>(window, "loginNote")->text().contains(QStringLiteral("Login Items")));
    }
};

QTEST_MAIN(MenuBarAppTest)

#include "menubarapptest.moc"
