// org.tokkl.Timer1 driven over a private D-Bus daemon, as the extension uses
// it, against the core's scripted transport, credential store and clock.

#include "alarmoutput.h"
#include "pomodoroalarm.h"
#include "statuspresentation.h"
#include "apitypes.h"
#include "configurationadapter.h"
#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "pomodorostore.h"
#include "privatebus.h"
#include "servicesettings.h"
#include "soundchoices.h"
#include "timercontroller.h"
#include "timerservice.h"
#include "timerstateclient.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusPendingCall>
#include <QDBusVariant>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMap>
#include <QSet>
#include <QPointer>
#include <QSettings>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>
#include <QXmlStreamReader>

#include <memory>
#include <optional>

using namespace Tokkl;

namespace
{
const QString instanceUrl = QStringLiteral("https://a.example.test");
const QString serviceBus = QStringLiteral("timerd-service");
const QString clientBus = QStringLiteral("timerd-client");
const QString propertiesInterface = QStringLiteral("org.freedesktop.DBus.Properties");
const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z");
const QString invalidArgs = QStringLiteral("org.freedesktop.DBus.Error.InvalidArgs");
// The a{si} and a{ss} properties, named so the test macros read them whole.
using IntMap = QMap<QString, int>;
using StringMap = QMap<QString, QString>;
// The account's lengths: one minute each, a long rest after two work phases.
const PomodoroConfig lengths{1, 1, 1, 2};

QByteArray json(const QJsonValue &value)
{
    return value.isArray() ? QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);
}

// A Configure call from the client bus for a token account, not waited for.
QDBusPendingCall configureCall(const QString &url, const QString &secret)
{
    QDBusMessage message = QDBusMessage::createMethodCall(TimerService::serviceName, TimerService::objectPath, TimerService::interfaceName, QStringLiteral("Configure"));
    message.setArguments({url, QStringLiteral("token"), QString(), secret});
    return QDBusConnection(clientBus).asyncCall(message);
}

QJsonObject entryObject(qint64 id, qint64 project, bool running, bool billable = false)
{
    const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("project_id"), project},
        {QStringLiteral("billable"), billable},
        {QStringLiteral("start"), startedAt},
        {QStringLiteral("stop"), running ? QJsonValue(QJsonValue::Null) : QJsonValue(begin.addSecs(60).toString(Qt::ISODate))},
        {QStringLiteral("duration"), running ? -begin.toSecsSinceEpoch() : 60},
        {QStringLiteral("description"), QString()},
        {QStringLiteral("tags"), QJsonArray()},
    };
}

// A billable entry on Beta (12) from begin: running, or stopped after the
// given seconds.
QJsonObject chainEntry(qint64 id, const QDateTime &begin, std::optional<qint64> seconds)
{
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("project_id"), 12},
        {QStringLiteral("billable"), true},
        {QStringLiteral("start"), begin.toString(Qt::ISODate)},
        {QStringLiteral("stop"), seconds ? QJsonValue(begin.addSecs(*seconds).toString(Qt::ISODate)) : QJsonValue(QJsonValue::Null)},
        {QStringLiteral("duration"), seconds ? *seconds : -begin.toSecsSinceEpoch()},
        {QStringLiteral("description"), QStringLiteral("Review")},
        {QStringLiteral("tags"), QJsonArray()},
    };
}

QJsonObject projectObject(qint64 id, const QString &name, const QString &color, bool billable)
{
    return QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("client_id"), QJsonValue(QJsonValue::Null)},
        {QStringLiteral("client_name"), QJsonValue(QJsonValue::Null)},
        {QStringLiteral("name"), name},
        {QStringLiteral("color"), color},
        {QStringLiteral("active"), true},
        {QStringLiteral("billable"), billable},
    };
}

// The answers of the instance to the reads the core sends, as a current
// server gives them.
const QByteArray meBody = json(QJsonObject{
    {QStringLiteral("id"), 3},
    {QStringLiteral("email"), QStringLiteral("bea@example.test")},
    {QStringLiteral("fullname"), QStringLiteral("Bea")},
    {QStringLiteral("timezone"), QStringLiteral("UTC")},
    {QStringLiteral("default_workspace_id"), 7},
    {QStringLiteral("beginning_of_week"), 1},
    {QStringLiteral("time_resolution_minutes"), 1},
});
const QByteArray projectsBody = json(QJsonArray{
    projectObject(11, QStringLiteral("Alpha"), QStringLiteral("#06aaf5"), true),
    projectObject(12, QStringLiteral("Beta"), QStringLiteral("#d94182"), false),
});

QByteArray preferencesBody(const PomodoroConfig &config)
{
    return json(QJsonObject{
        {QStringLiteral("pomodoro_focus_interval_in_minutes"), config.workMinutes},
        {QStringLiteral("pomodoro_break_interval_in_minutes"), config.shortRestMinutes},
        {QStringLiteral("pomodoro_long_break_interval_in_minutes"), config.longRestMinutes},
        {QStringLiteral("pomodoro_long_break_every"), config.longRestEvery},
    });
}

// An error body: the API sends the message as a bare JSON string.
QByteArray errorBody(const char *text)
{
    return QByteArrayLiteral("\"") + QByteArray(text) + QByteArrayLiteral("\"");
}

IntMap lengthsMap(const PomodoroConfig &config)
{
    return {
        {QStringLiteral("work"), config.workMinutes},
        {QStringLiteral("shortRest"), config.shortRestMinutes},
        {QStringLiteral("longRest"), config.longRestMinutes},
        {QStringLiteral("longRestEvery"), config.longRestEvery},
    };
}

// GET /api/app/time_entries/latest: the newest entry the account has,
// stopped, on Alpha.
QByteArray latestBody()
{
    QJsonObject entry = entryObject(4, 11, false, true);
    entry.insert(QStringLiteral("project_active"), true);
    entry.insert(QStringLiteral("project_billable"), true);
    return json(entry);
}

QString iso(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODateWithMs);
}

// The server's pause chain of the entries chainEntry() builds: Review on
// Beta, with the seconds its stopped entries stored, and the running clone
// unless paused.
QJsonObject pauseObject(bool paused, qint64 seconds, std::optional<qint64> clone = std::nullopt)
{
    return QJsonObject{
        {QStringLiteral("paused"), paused},
        {QStringLiteral("seconds"), seconds},
        {QStringLiteral("workspace_id"), 7},
        {QStringLiteral("description"), QStringLiteral("Review")},
        {QStringLiteral("project_id"), 12},
        {QStringLiteral("task_id"), QJsonValue(QJsonValue::Null)},
        {QStringLiteral("tag_ids"), QJsonArray()},
        {QStringLiteral("tags"), QJsonArray()},
        {QStringLiteral("billable"), true},
        {QStringLiteral("clone_entry_id"), clone ? QJsonValue(*clone) : QJsonValue(QJsonValue::Null)},
    };
}

// The phase of a session on the server's clock, with what the server derives
// from it. The account's lengths are one minute each, with a long rest after
// every second work phase.
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
    const bool longRestNext = completed + 1 >= lengths.longRestEvery;
    return Phase{QStringLiteral("work"),
                 start,
                 completed,
                 longRestNext ? QStringLiteral("longRest") : QStringLiteral("shortRest"),
                 longRestNext ? QStringLiteral("workToLongRest") : QStringLiteral("workToShortRest"),
                 completed + 1,
                 start};
}

Phase shortRest(const QDateTime &start, const QDateTime &pomodoroStart)
{
    return Phase{QStringLiteral("shortRest"), start, 1, QStringLiteral("work"), QStringLiteral("shortRestToWork"), 1, pomodoroStart};
}

QJsonObject pomodoroObject(const Phase &phase, qint64 entryId)
{
    return QJsonObject{
        {QStringLiteral("work_minutes"), lengths.workMinutes},
        {QStringLiteral("short_rest_minutes"), lengths.shortRestMinutes},
        {QStringLiteral("long_rest_minutes"), lengths.longRestMinutes},
        {QStringLiteral("long_rest_every"), lengths.longRestEvery},
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
        {QStringLiteral("pomodoro_start"), iso(phase.pomodoroStart)},
    };
}

// The body of an action that carries the revision it was made against.
QJsonObject revisionBody(qint64 revision)
{
    return QJsonObject{{QStringLiteral("revision"), revision}};
}

struct Interface {
    StringMap properties; // name -> "type access"
    QMap<QString, QStringList> methods; // name -> "direction type" per argument
    QSet<QString> signalNames;
};

// The interfaces of an introspection document, by name.
QMap<QString, Interface> parseIntrospection(const QByteArray &xml)
{
    QMap<QString, Interface> interfaces;
    QXmlStreamReader reader(xml);
    QString interface;
    QString method;
    while (!reader.atEnd()) {
        reader.readNext();
        if (!reader.isStartElement()) {
            continue;
        }
        const auto attributes = reader.attributes();
        const QString name = attributes.value(QStringLiteral("name")).toString();
        if (reader.name() == QLatin1String("interface")) {
            interface = name;
            interfaces[interface];
        } else if (reader.name() == QLatin1String("property")) {
            interfaces[interface].properties.insert(name,
                                                    attributes.value(QStringLiteral("type")).toString() + QLatin1Char(' ')
                                                        + attributes.value(QStringLiteral("access")).toString());
        } else if (reader.name() == QLatin1String("method")) {
            method = name;
            interfaces[interface].methods[method];
        } else if (reader.name() == QLatin1String("signal")) {
            method.clear();
            interfaces[interface].signalNames.insert(name);
        } else if (reader.name() == QLatin1String("arg") && !method.isEmpty()) {
            const QString direction = attributes.value(QStringLiteral("direction")).toString();
            interfaces[interface].methods[method].append((direction.isEmpty() ? QStringLiteral("in") : direction) + QLatin1Char(' ')
                                                         + attributes.value(QStringLiteral("type")).toString());
        }
    }
    return interfaces;
}

// Records PropertiesChanged and RequestFinished of org.tokkl.Timer1 on the
// client connection.
class ChangeRecorder : public QObject
{
    Q_OBJECT

public:
    QList<QVariantMap> changes;
    // Each RequestFinished as its id, ok and error.
    QList<QVariantList> finished;

    // Every value a property took, in order.
    QVariantList valuesOf(const QString &property) const
    {
        QVariantList values;
        for (const QVariantMap &change : changes) {
            if (change.contains(property)) {
                values.append(change.value(property));
            }
        }
        return values;
    }

public Q_SLOTS:
    void propertiesChanged(const QString &interface, const QVariantMap &changed, const QStringList &invalidated)
    {
        if (interface == TimerService::interfaceName && invalidated.isEmpty()) {
            changes.append(changed);
        }
    }

    void requestFinished(qulonglong request, bool ok, const QString &error)
    {
        finished.append({request, ok, error});
    }
};

// Records what the alarm asks of the audio, one line per call.
class FakeAlarmOutput : public AlarmOutput
{
public:
    QStringList calls;

    void loop(const QString &file) override
    {
        calls.append(QStringLiteral("loop ") + file);
    }

    void playOnce(const QString &file) override
    {
        calls.append(QStringLiteral("once ") + file);
    }

    void stop() override
    {
        calls.append(QStringLiteral("stop"));
    }

    // As a sound server that refused the last sound.
    void fail(const QString &reason)
    {
        reportFailure(reason);
    }
};

// A keyring whose writes wait until the test finishes them, in any order.
// Reads find nothing.
class HeldStore : public CredentialStore
{
    Q_OBJECT

public:
    struct Write {
        QString key;
        QPointer<QObject> context;
        Callback done;
    };

    void read(const QString &, QObject *context, Callback done) override
    {
        QPointer<QObject> guard(context);
        QMetaObject::invokeMethod(
            context,
            [guard, done] {
                if (guard) {
                    done(CredentialResult{CredentialResult::Status::NotFound, QString()});
                }
            },
            Qt::QueuedConnection);
    }

    void write(const QString &key, const QString &, QObject *context, Callback done) override
    {
        held.append(Write{key, context, done});
    }

    void finish(qsizetype index)
    {
        const Write write = held.at(index);
        const CredentialResult result{CredentialResult::Status::Ok, QString()};
        reportWrite(write.key, result);
        if (write.context) {
            write.done(result);
        }
    }

    QList<Write> held;
};

// The bundled sounds, from the core's sounds/ directory.
QString bundledSoundsDir()
{
    const QStringList files = QString::fromUtf8(TOKKL_POMODORO_SOUND_FILES).split(QLatin1Char('|'));
    return QFileInfo(files.first()).absolutePath();
}

QString bundled(const QString &soundId)
{
    return bundledSoundsDir() + QStringLiteral("/pomodoro-") + soundId + QStringLiteral(".wav");
}
}

// The object graph main.cpp builds for tokkl-timerd, on the test's
// transport, credential store and clock, in the same order.
struct Daemon {
    Daemon(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock)
        : settings(settingsFile, QSettings::IniFormat)
        , connection(transport, store, TimerService::clientName())
        , timer(clock)
        , client(&connection, clock)
        , pomodoroStore(&settings)
        , sounds(&settings, &TimerService::soundKey)
        , preferences(&connection)
        , session(clock, bound(timer, client), &client, &pomodoroStore)
        , connectionSettings(&settings, &connection, store)
        , configuration(&connectionSettings)
        , service({&timer, timer.coordinator(), &session, &preferences, &sounds, &configuration})
    {
        connection.setClock(clock);
        connectionSettings.load();
    }

    // main.cpp gives the timer its client before it builds the session.
    static TimerCoordinator *bound(TimerController &timer, TimerStateClient &client)
    {
        timer.setStateClient(&client);
        return timer.coordinator();
    }

    QSettings settings;
    Connection connection;
    TimerController timer;
    TimerStateClient client;
    SettingsPomodoroStore pomodoroStore;
    SoundChoices sounds;
    PomodoroPreferences preferences;
    PomodoroSession session;
    ServiceSettings connectionSettings;
    ConfigurationAdapter configuration;
    TimerService service;
};

class TimerServiceTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        std::unique_ptr<Daemon> daemon;
        TimerService *service = nullptr;
        ChangeRecorder recorder;
        QSet<qsizetype> answered;
        // What the server holds for the account, at its revision. serve()
        // answers every state read with it.
        QJsonValue running = QJsonValue::Null;
        QJsonValue chain = QJsonValue::Null;
        QJsonValue session = QJsonValue::Null;
        QJsonValue dropped = QJsonValue::Null;
        qint64 revision = 1;
        // How far the server's clock runs ahead of this machine's.
        qint64 serverAheadMs = 0;

        QString settingsFile() const
        {
            return dir.filePath(QStringLiteral("tokkl/tokkl-timerd.conf"));
        }

        bool start()
        {
            transport.status = FakeTransport::currentStatus();
            daemon = std::make_unique<Daemon>(&transport, &store, settingsFile(), &clock);
            service = &daemon->service;
            if (!service->registerOn(QDBusConnection(serviceBus))) {
                return false;
            }
            QDBusConnection client(clientBus);
            if (!client.connect(TimerService::serviceName,
                                TimerService::objectPath,
                                propertiesInterface,
                                QStringLiteral("PropertiesChanged"),
                                &recorder,
                                SLOT(propertiesChanged(QString, QVariantMap, QStringList)))) {
                return false;
            }
            if (!client.connect(TimerService::serviceName,
                                TimerService::objectPath,
                                TimerService::interfaceName,
                                QStringLiteral("RequestFinished"),
                                &recorder,
                                SLOT(requestFinished(qulonglong, bool, QString)))) {
                return false;
            }
            // A round trip, so the match rule is in place before anything changes.
            return ping();
        }

        bool ping() const
        {
            return call(QStringLiteral("org.freedesktop.DBus.Peer"), QStringLiteral("Ping")).type() == QDBusMessage::ReplyMessage;
        }

        // Replaces the service with a new one on the same settings file, as
        // a restart of tokkl-timerd. The recorder stays connected.
        bool restart()
        {
            service = nullptr;
            daemon.reset();
            daemon = std::make_unique<Daemon>(&transport, &store, settingsFile(), &clock);
            service = &daemon->service;
            return service->registerOn(QDBusConnection(serviceBus)) && ping();
        }

        // One tick per second, as the system clock ticks.
        void advance(int seconds)
        {
            for (int i = 0; i < seconds; ++i) {
                clock.advance(1000);
            }
        }

        QDBusMessage call(const QString &interface, const QString &method, const QVariantList &arguments = {}) const
        {
            QDBusMessage message = QDBusMessage::createMethodCall(TimerService::serviceName, TimerService::objectPath, interface, method);
            message.setArguments(arguments);
            // The service answers on this thread, so wait without blocking it.
            QDBusPendingCall pending = QDBusConnection(clientBus).asyncCall(message);
            if (!QTest::qWaitFor(
                    [&pending] {
                        return pending.isFinished();
                    },
                    10000)) {
                return QDBusMessage();
            }
            return pending.reply();
        }

        QDBusMessage timer(const QString &method, const QVariantList &arguments = {}) const
        {
            return call(TimerService::interfaceName, method, arguments);
        }

        // The first output of a method call, or an invalid variant on error.
        QVariant result(const QString &method, const QVariantList &arguments = {}) const
        {
            const QDBusMessage reply = timer(method, arguments);
            return reply.type() == QDBusMessage::ReplyMessage && !reply.arguments().isEmpty() ? reply.arguments().constFirst() : QVariant();
        }

        QVariant get(const QString &property) const
        {
            const QDBusMessage reply = call(propertiesInterface, QStringLiteral("Get"), {TimerService::interfaceName, property});
            if (reply.type() != QDBusMessage::ReplyMessage) {
                return QVariant();
            }
            return reply.arguments().constFirst().value<QDBusVariant>().variant();
        }

        // The server's state at its current revision, on the fake clock.
        QByteArray state() const
        {
            return json(QJsonObject{
                {QStringLiteral("revision"), revision},
                {QStringLiteral("server_time"), iso(clock.now().addMSecs(serverAheadMs))},
                {QStringLiteral("running_entry"), running},
                {QStringLiteral("pause"), chain},
                {QStringLiteral("pomodoro"), session},
                {QStringLiteral("discarded_pomodoro"), dropped},
            });
        }

        // A change on the server: the next revision, which is also returned
        // as the state an action or the event stream sends.
        QByteArray change(const QJsonValue &runningEntry, const QJsonValue &pauseChain = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null, const QJsonValue &discardedPomodoro = QJsonValue::Null)
        {
            running = runningEntry;
            chain = pauseChain;
            session = pomodoro;
            dropped = discardedPomodoro;
            ++revision;
            return state();
        }

        // A state from the event stream, as another device's change sends it.
        bool push(const QByteArray &state)
        {
            FakeStream *stream = transport.lastStream();
            if (!stream) {
                return false;
            }
            stream->push("event: timer\ndata: " + state + "\n\n");
            return true;
        }

        // Requests whose API path ends with the given text.
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

        void respond(qsizetype index, const HttpResponse &response)
        {
            answered.insert(index);
            transport.respond(index, response);
        }

        // Answers the latest request with the method and path, as the
        // instance would. False when there is none.
        bool answer(const QByteArray &method, const QByteArray &suffix, const QByteArray &body, int status = 200)
        {
            const QList<qsizetype> found = find(method, suffix);
            if (found.isEmpty()) {
                return false;
            }
            respond(found.last(), FakeTransport::answer(status, body));
            return true;
        }

        // Answers every read the core sends, as the instance would, until the
        // service reports ready with nothing left to read.
        bool serve()
        {
            return QTest::qWaitFor([this] {
                bool pending = false;
                for (qsizetype i = 0; i < transport.requests.size(); ++i) {
                    const HttpRequest &request = transport.requests.at(i);
                    if (answered.contains(i) || request.method != "GET") {
                        continue;
                    }
                    const QByteArray path = request.url.path().toUtf8();
                    QByteArray body;
                    if (path.endsWith("/me")) {
                        body = meBody;
                    } else if (path.endsWith("/app/timer")) {
                        body = state();
                    } else if (path.endsWith("/projects")) {
                        body = projectsBody;
                    } else if (path.endsWith("/app/time_entries/latest")) {
                        body = latestBody();
                    } else if (path.endsWith("/me/preferences")) {
                        body = preferencesBody(lengths);
                    } else {
                        continue;
                    }
                    pending = true;
                    respond(i, FakeTransport::answer(200, body));
                }
                return !pending && service->status() == QLatin1String("ready");
            });
        }

        // Configure over the bus with a token, then answer the reads.
        bool connect()
        {
            const QDBusMessage reply = timer(QStringLiteral("Configure"), {instanceUrl, QStringLiteral("token"), QString(), QStringLiteral("tok-1")});
            return reply.type() == QDBusMessage::ReplyMessage && serve();
        }
    };

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_home.isValid());
        const QByteArray address = m_bus.start(m_home.path());
        QVERIFY(!address.isEmpty());
        QVERIFY(QDBusConnection::connectToBus(QString::fromUtf8(address), serviceBus).isConnected());
        QVERIFY(QDBusConnection::connectToBus(QString::fromUtf8(address), clientBus).isConnected());
        qDBusRegisterMetaType<QList<QVariantMap>>();
        qDBusRegisterMetaType<IntMap>();
        qDBusRegisterMetaType<StringMap>();
    }

    void cleanupTestCase()
    {
        QDBusConnection::disconnectFromBus(serviceBus);
        QDBusConnection::disconnectFromBus(clientBus);
        m_bus.stop();
    }

    // Introspection shows the interface of dbus/org.tokkl.Timer1.xml, and the
    // properties announce changes through PropertiesChanged.
    void introspection()
    {
        Fixture f;
        QVERIFY(f.start());
        const QDBusMessage reply = f.call(QStringLiteral("org.freedesktop.DBus.Introspectable"), QStringLiteral("Introspect"));
        QCOMPARE(reply.type(), QDBusMessage::ReplyMessage);
        const QMap<QString, Interface> live = parseIntrospection(reply.arguments().constFirst().toString().toUtf8());

        QFile file(QStringLiteral(TOKKL_TIMER1_XML));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const Interface described = parseIntrospection(file.readAll()).value(TimerService::interfaceName);

        QVERIFY(live.contains(TimerService::interfaceName));
        const Interface timer = live.value(TimerService::interfaceName);
        const StringMap properties{
            {QStringLiteral("Running"), QStringLiteral("b read")},
            {QStringLiteral("StartTime"), QStringLiteral("x read")},
            {QStringLiteral("LocalStartTime"), QStringLiteral("x read")},
            {QStringLiteral("Paused"), QStringLiteral("b read")},
            {QStringLiteral("ChainSeconds"), QStringLiteral("x read")},
            {QStringLiteral("IndicatorState"), QStringLiteral("s read")},
            {QStringLiteral("IndicatorColor"), QStringLiteral("s read")},
            {QStringLiteral("Projects"), QStringLiteral("aa{sv} read")},
            {QStringLiteral("ProjectsIncomplete"), QStringLiteral("b read")},
            {QStringLiteral("ChosenProject"), QStringLiteral("x read")},
            {QStringLiteral("ChosenProjectName"), QStringLiteral("s read")},
            {QStringLiteral("ChosenProjectLabel"), QStringLiteral("a{sv} read")},
            {QStringLiteral("Billable"), QStringLiteral("b read")},
            {QStringLiteral("Status"), QStringLiteral("s read")},
            {QStringLiteral("ErrorString"), QStringLiteral("s read")},
            {QStringLiteral("PomodoroMode"), QStringLiteral("b read")},
            {QStringLiteral("ModeLocked"), QStringLiteral("b read")},
            {QStringLiteral("SessionActive"), QStringLiteral("b read")},
            {QStringLiteral("CanStartSession"), QStringLiteral("b read")},
            {QStringLiteral("Phase"), QStringLiteral("s read")},
            {QStringLiteral("PhaseStart"), QStringLiteral("x read")},
            {QStringLiteral("PlannedEnd"), QStringLiteral("x read")},
            {QStringLiteral("PomodoroNumber"), QStringLiteral("i read")},
            {QStringLiteral("LongRestEvery"), QStringLiteral("i read")},
            {QStringLiteral("UpcomingPhase"), QStringLiteral("s read")},
            {QStringLiteral("Ringing"), QStringLiteral("b read")},
            {QStringLiteral("RingingTransition"), QStringLiteral("s read")},
            {QStringLiteral("SessionMessage"), QStringLiteral("s read")},
            {QStringLiteral("Actions"), QStringLiteral("a{sa{sv}} read")},
            {QStringLiteral("Presentation"), QStringLiteral("a{sv} read")},
            {QStringLiteral("PomodoroLengths"), QStringLiteral("a{si} read")},
            {QStringLiteral("PomodoroLengthsEditable"), QStringLiteral("b read")},
            {QStringLiteral("PomodoroLengthErrors"), QStringLiteral("a{ss} read")},
            {QStringLiteral("PomodoroLengthLimits"), QStringLiteral("a{sa{si}} read")},
            {QStringLiteral("Sounds"), QStringLiteral("a{ss} read")},
            {QStringLiteral("SoundChoices"), QStringLiteral("aa{sv} read")},
            {QStringLiteral("AlarmError"), QStringLiteral("s read")},
            {QStringLiteral("InterfaceVersion"), QStringLiteral("u read")},
        };
        QCOMPARE(timer.properties, properties);
        // The version of the interface, which the extension picks its
        // fallbacks by.
        const QVariant version = f.get(QStringLiteral("InterfaceVersion"));
        QCOMPARE(version.metaType(), QMetaType::fromType<uint>());
        QCOMPARE(version.toUInt(), 2u);
        const QMap<QString, QStringList> methods{
            {QStringLiteral("Start"), {QStringLiteral("out b")}},
            {QStringLiteral("Stop"), {QStringLiteral("out b")}},
            {QStringLiteral("Pause"), {QStringLiteral("out b")}},
            {QStringLiteral("Resume"), {QStringLiteral("out b")}},
            {QStringLiteral("RequestStart"), {QStringLiteral("out t")}},
            {QStringLiteral("RequestStop"), {QStringLiteral("out t")}},
            {QStringLiteral("RequestPause"), {QStringLiteral("out t")}},
            {QStringLiteral("RequestResume"), {QStringLiteral("out t")}},
            {QStringLiteral("SetProject"), {QStringLiteral("in x"), QStringLiteral("out b")}},
            {QStringLiteral("SetBillable"), {QStringLiteral("in b"), QStringLiteral("out b")}},
            {QStringLiteral("Configure"), {QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("in s")}},
            {QStringLiteral("SetPomodoroMode"), {QStringLiteral("in b"), QStringLiteral("out b")}},
            {QStringLiteral("Activate"), {QStringLiteral("out s")}},
            {QStringLiteral("StartSession"), {QStringLiteral("out b")}},
            {QStringLiteral("NextPhase"), {QStringLiteral("out b")}},
            {QStringLiteral("EndSession"), {QStringLiteral("out b")}},
            {QStringLiteral("SetPomodoroLengths"), {QStringLiteral("in i"), QStringLiteral("in i"), QStringLiteral("in i"), QStringLiteral("in i"), QStringLiteral("out b")}},
            {QStringLiteral("RefreshPreferences"), {}},
            {QStringLiteral("RefreshProjects"), {}},
            {QStringLiteral("SetSound"), {QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("out b")}},
            {QStringLiteral("PreviewSound"), {QStringLiteral("in s"), QStringLiteral("out b")}},
        };
        QCOMPARE(timer.methods, methods);
        QCOMPARE(described.properties, timer.properties);
        QCOMPARE(described.methods, timer.methods);
        QCOMPARE(timer.signalNames, QSet<QString>{QStringLiteral("RequestFinished")});
        QCOMPARE(described.signalNames, timer.signalNames);
        QVERIFY(live.value(propertiesInterface).signalNames.contains(QStringLiteral("PropertiesChanged")));
    }

    // Configure saves the secret and the settings, the core connects, and each
    // property follows its core property and announces the change.
    void configureConnectsAndPublishes()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("unconfigured"));
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("none"));

        const QDBusMessage reply =
            f.timer(QStringLiteral("Configure"), {QString(instanceUrl + QLatin1Char('/')), QStringLiteral("token"), QString(), QStringLiteral(" tok-1 ")});
        QCOMPARE(reply.type(), QDBusMessage::ReplyMessage);
        QCOMPARE(f.store.secrets.value(credentialKey(parseInstanceUrl(instanceUrl), AuthMode::Token, QString())), QStringLiteral("tok-1"));
        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("instanceUrl")).toString(), instanceUrl);
            QCOMPARE(settings.value(QStringLiteral("authMode")).toString(), QStringLiteral("token"));
            QFile file(f.settingsFile());
            QVERIFY(file.open(QIODevice::ReadOnly));
            QVERIFY(!file.readAll().contains("tok-1"));
        }
        QVERIFY(f.serve());

        const QList<qsizetype> me = f.find("GET", "/me");
        QCOMPARE(me.size(), 1);
        QCOMPARE(f.transport.requests.at(me.first()).authorization, basicAuthorization(AuthMode::Token, QString(), QStringLiteral("tok-1")));

        // The next start defaults to the project of the last entry.
        TimerController *core = &f.daemon->timer;
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("ready"));
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 11);
        QCOMPARE(core->chosenProjectId().toLongLong(), 11);
        QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QStringLiteral("Alpha"));
        QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), core->chosenBillable());
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("project"));
        QCOMPARE(f.get(QStringLiteral("IndicatorColor")).toString(), QStringLiteral("#06aaf5"));
        QCOMPARE(f.get(QStringLiteral("ErrorString")).toString(), QString());

        const QList<QVariantMap> projects = qdbus_cast<QList<QVariantMap>>(f.get(QStringLiteral("Projects")));
        QCOMPARE(projects.size(), 2);
        QCOMPARE(projects.at(0).value(QStringLiteral("id")).toLongLong(), 11);
        QCOMPARE(projects.at(0).value(QStringLiteral("name")).toString(), QStringLiteral("Alpha"));
        QCOMPARE(projects.at(0).value(QStringLiteral("color")).toString(), QStringLiteral("#06aaf5"));
        QCOMPARE(projects.at(0).value(QStringLiteral("billable")).toBool(), true);
        QCOMPARE(projects.at(1).value(QStringLiteral("name")).toString(), QStringLiteral("Beta"));

        // The changes reached the bus as PropertiesChanged.
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("Status")).contains(QStringLiteral("ready"));
        }));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Status")).contains(QStringLiteral("loading")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ChosenProject")).contains(11));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ChosenProjectName")).contains(QStringLiteral("Alpha")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("IndicatorColor")).contains(QStringLiteral("#06aaf5")));
        const QVariantList published = f.recorder.valuesOf(QStringLiteral("Projects"));
        QVERIFY(!published.isEmpty());
        QCOMPARE(qdbus_cast<QList<QVariantMap>>(published.last()).size(), 2);
        // Only values that changed travel.
        for (const QVariantMap &change : std::as_const(f.recorder.changes)) {
            QVERIFY(!change.isEmpty());
        }
    }

    // A state that changes properties of every kind reaches the bus as one
    // PropertiesChanged, and each property Get reads differently afterwards
    // is in it with that value.
    void changesArriveOncePerTurn()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QFile file(QStringLiteral(TOKKL_TIMER1_XML));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QStringList names = parseIntrospection(file.readAll()).value(TimerService::interfaceName).properties.keys();
        // Only plain values compare after the bus; containers arrive as
        // QDBusArgument.
        const auto plain = [](const QVariant &value) {
            return value.metaType() != QMetaType::fromType<QDBusArgument>();
        };
        QVariantMap before;
        for (const QString &name : names) {
            before.insert(name, f.get(name));
        }
        QVERIFY(f.ping());
        const qsizetype published = f.recorder.changes.size();

        // Another device starts an entry: the entry, the mode lock, the
        // actions and the project shown change together.
        QVERIFY(f.push(f.change(entryObject(5, 12, true))));
        QVERIFY(QTest::qWaitFor([&f, published] {
            return f.recorder.changes.size() > published;
        }));
        QVERIFY(f.ping());
        QCOMPARE(f.recorder.changes.size(), published + 1);
        const QVariantMap change = f.recorder.changes.last();
        for (const QString &name : {QStringLiteral("Running"), QStringLiteral("StartTime"), QStringLiteral("ModeLocked"), QStringLiteral("Actions"),
                                    QStringLiteral("ChosenProject")}) {
            QVERIFY2(change.contains(name), qPrintable(name));
        }
        for (const QString &name : names) {
            const QVariant after = f.get(name);
            if (plain(after) && after != before.value(name)) {
                QVERIFY2(change.contains(name), qPrintable(name));
                QCOMPARE(change.value(name), after);
            }
        }
    }

    // The core's project rules hold over the bus, and the entries the service
    // starts carry its client name.
    void projectRulesAndClientName()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());

        // A pick while stopped wins over the default and applies the
        // project's billable default.
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(12)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);
        QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("IndicatorColor")).toString(), QStringLiteral("#d94182"));
        // Only an active project of the workspace is a choice.
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(999)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);

        // Start creates a new entry on the chosen project, against the
        // revision shown.
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        const QList<qsizetype> starts = f.find("POST", "/app/timer/start");
        QCOMPARE(starts.size(), 1);
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(starts.first()).body).object();
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
        QCOMPARE(body.value(QStringLiteral("revision")).toInteger(), f.revision);
        // A second start while the first is in flight sends nothing.
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);

        f.respond(starts.first(), FakeTransport::answer(200, f.change(entryObject(5, 12, true))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        const qint64 start = QDateTime::fromString(startedAt, Qt::ISODate).toSecsSinceEpoch();
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), start);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Running")).contains(true));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("StartTime")).contains(start));

        // The project is locked while the entry runs.
        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(11)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);

        // Billable stays editable: one timer edit that carries only billable,
        // naming the running entry.
        QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(true)}).toBool(), true);
        const QList<qsizetype> updates = f.find("POST", "/app/timer/edit");
        QCOMPARE(updates.size(), 1);
        const QJsonObject expected{{QStringLiteral("billable"), true}, {QStringLiteral("entry_id"), 5}};
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(updates.first()).body).object(), expected);
        QVERIFY(f.find("PUT", "/workspaces/7/time_entries/5").isEmpty());
        f.respond(updates.first(), FakeTransport::answer(200, f.change(entryObject(5, 12, true, true))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Billable")).contains(true));

        // Stop, after which the next start defaults to the stopped entry's project.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        const QList<qsizetype> stops = f.find("POST", "/app/timer/stop");
        QCOMPARE(stops.size(), 1);
        QCOMPARE(f.transport.requests.at(stops.first()).body, json(revisionBody(f.revision)));
        f.respond(stops.first(), FakeTransport::answer(200, f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Running")).contains(false));
        // No project, while stopped, is a valid pick.
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("none"));
    }

    // A request is followed to its end: RequestFinished carries its id with
    // the outcome, after the properties it changed, and the plain methods
    // send none.
    void requestsReportTheirEnd()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        const auto requestOf = [](const QVariant &value) {
            return value.toULongLong();
        };

        // A start the server refuses.
        const qulonglong refusedStart = requestOf(f.result(QStringLiteral("RequestStart")));
        QVERIFY(refusedStart > 0);
        // One write at a time: nothing is sent while it runs.
        QCOMPARE(requestOf(f.result(QStringLiteral("RequestStart"))), 0ULL);
        const QList<qsizetype> starts = f.find("POST", "/app/timer/start");
        QCOMPARE(starts.size(), 1);
        f.respond(starts.first(), FakeTransport::answer(400, errorBody("Project is archived")));
        QTRY_COMPARE(f.recorder.finished.size(), 1);
        QCOMPARE(f.recorder.finished.last(), (QVariantList{refusedStart, false, QStringLiteral("Project is archived")}));
        // ErrorString had the words before the signal came.
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ErrorString")).contains(QStringLiteral("Project is archived")));

        // A start the server applies, with the next id.
        const qulonglong start = requestOf(f.result(QStringLiteral("RequestStart")));
        QVERIFY(start > refusedStart);
        f.respond(f.find("POST", "/app/timer/start").last(), FakeTransport::answer(200, f.change(entryObject(5, 11, true))));
        QTRY_COMPARE(f.recorder.finished.size(), 2);
        QCOMPARE(f.recorder.finished.last(), (QVariantList{start, true, QString()}));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);

        // A pause whose answer never comes: not ok, with the connection's
        // words.
        const qulonglong pause = requestOf(f.result(QStringLiteral("RequestPause")));
        QVERIFY(pause > start);
        f.respond(f.find("POST", "/app/timer/pause").last(), FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QTRY_COMPARE(f.recorder.finished.size(), 3);
        QCOMPARE(f.recorder.finished.last().at(0).toULongLong(), pause);
        QCOMPARE(f.recorder.finished.last().at(1).toBool(), false);
        QVERIFY(!f.recorder.finished.last().at(2).toString().isEmpty());
        QVERIFY(f.serve());

        // The plain method sends and reports nothing more; a request with
        // nothing to do returns 0.
        QCOMPARE(requestOf(f.result(QStringLiteral("RequestResume"))), 0ULL);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        f.respond(f.find("POST", "/app/timer/stop").last(), FakeTransport::answer(200, f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QCOMPARE(f.recorder.finished.size(), 3);
    }

    // The server's clock runs 90 s ahead of this machine's. StartTime keeps
    // the server's start; LocalStartTime is on this machine's clock, so the
    // extension's elapsed time, its clock minus LocalStartTime, is the
    // core's.
    void localStartTimeFollowsTheServerClock()
    {
        Fixture f;
        f.serverAheadMs = 90000;
        f.running = entryObject(5, 12, true);
        QVERIFY(f.start());
        QVERIFY(f.connect());
        const qint64 start = QDateTime::fromString(startedAt, Qt::ISODate).toSecsSinceEpoch();
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), start);
        const qint64 local = f.get(QStringLiteral("LocalStartTime")).toLongLong();
        QCOMPARE(local, start - 90);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("LocalStartTime")).contains(start - 90));
        QCOMPARE(f.clock.now().toSecsSinceEpoch() - local, f.daemon->timer.elapsedSeconds());

        // This machine's clock is set 60 s forward. The same state, read
        // again, moves only the offset, and LocalStartTime follows it.
        f.clock.current = f.clock.current.addSecs(60);
        f.serverAheadMs = 30000;
        QVERIFY(f.push(f.state()));
        QTRY_VERIFY(f.recorder.valuesOf(QStringLiteral("LocalStartTime")).contains(start - 30));
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), start);
        QCOMPARE(f.clock.now().toSecsSinceEpoch() - (start - 30), f.daemon->timer.elapsedSeconds());

        // Stopped elsewhere: both are 0.
        QVERIFY(f.push(f.change(QJsonValue::Null)));
        QTRY_COMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("LocalStartTime")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
    }

    // RefreshProjects, which the extension calls when its menu opens, asks
    // for the catalog revision and reads the list only when it moved.
    void refreshProjectsReadsTheListWhenItMoved()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        const qsizetype lists = f.find("GET", "/projects").size();
        const qsizetype checks = f.transport.catalogRequests.size();
        const qsizetype states = f.find("GET", "/timer").size();

        QCOMPARE(f.timer(QStringLiteral("RefreshProjects")).type(), QDBusMessage::ReplyMessage);
        QTRY_COMPARE(f.transport.catalogRequests.size(), checks + 1);
        QTest::qWait(20);
        QCOMPARE(f.find("GET", "/projects").size(), lists);

        f.transport.catalog = FakeTransport::catalogAt(2);
        QCOMPARE(f.timer(QStringLiteral("RefreshProjects")).type(), QDBusMessage::ReplyMessage);
        QTRY_COMPARE(f.find("GET", "/projects").size(), lists + 1);
        QVERIFY(f.answer("GET", "/projects", json(QJsonArray{projectObject(12, QStringLiteral("Beta"), QStringLiteral("#112233"), true)})));
        QTRY_COMPARE(f.service->projects().size(), 1);
        QCOMPARE(f.service->projects().constFirst().value(QStringLiteral("name")).toString(), QStringLiteral("Beta"));
        QCOMPARE(f.find("GET", "/timer").size(), states);
    }

    // A project list cut short at the paging limit is published as such.
    void projectsIncompleteIsPublished()
    {
        Fixture f;
        QJsonArray page;
        for (int id = 1; id <= Connection::projectPageSize; ++id) {
            page.append(QJsonObject{{QStringLiteral("id"), id},
                                    {QStringLiteral("workspace_id"), 7},
                                    {QStringLiteral("name"), QStringLiteral("P%1").arg(id)},
                                    {QStringLiteral("active"), true}});
        }
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("ProjectsIncomplete")).toBool(), false);

        // The projects changed, and every page up to the limit is full and
        // new.
        f.transport.catalog = FakeTransport::catalogAt(2);
        QCOMPARE(f.timer(QStringLiteral("RefreshProjects")).type(), QDBusMessage::ReplyMessage);
        for (int number = 1; number <= Connection::maxProjectPages; ++number) {
            QJsonArray shifted;
            for (const QJsonValue &value : std::as_const(page)) {
                QJsonObject project = value.toObject();
                project.insert(QStringLiteral("id"), project.value(QStringLiteral("id")).toInteger() + (number - 1) * Connection::projectPageSize);
                shifted.append(project);
            }
            QVERIFY(QTest::qWaitFor([&f] {
                const QList<qsizetype> reads = f.find("GET", "/projects");
                return !reads.isEmpty() && !f.answered.contains(reads.last());
            }));
            QVERIFY(f.answer("GET", "/projects", json(shifted)));
        }
        QTRY_COMPARE(f.get(QStringLiteral("ProjectsIncomplete")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ProjectsIncomplete")).contains(true));
        // The projects read stay offered.
        QCOMPARE(f.service->projects().size(), Connection::maxProjectPages * Connection::projectPageSize);
    }

    // A running entry on an archived project: Projects lacks it, but the
    // core reads it, so the indicator shows it and ChosenProjectName names it.
    void archivedRunningProjectIsNamed()
    {
        Fixture f;
        f.change(entryObject(5, 99, true));
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 99);

        qsizetype read = -1;
        QVERIFY(QTest::qWaitFor([&f, &read] {
            const QList<qsizetype> found = f.find("GET", "/workspaces/7/projects/99");
            read = found.isEmpty() ? -1 : found.constFirst();
            return read >= 0;
        }));
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("pending"));
        QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QString());

        QJsonObject archived = projectObject(99, QStringLiteral("Legacy"), QStringLiteral("#2da608"), false);
        archived.insert(QStringLiteral("active"), false);
        f.respond(read, FakeTransport::answer(200, json(archived)));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.get(QStringLiteral("IndicatorState")).toString() == QLatin1String("project");
        }));
        QCOMPARE(f.get(QStringLiteral("IndicatorColor")).toString(), QStringLiteral("#2da608"));
        QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QStringLiteral("Legacy"));
        // The label's parts say it is archived, so the extension words it
        // as the KDE and macOS menus do.
        const QVariantMap label = qdbus_cast<QVariantMap>(f.get(QStringLiteral("ChosenProjectLabel")));
        QCOMPARE(label.value(QStringLiteral("name")).toString(), QStringLiteral("Legacy"));
        QCOMPARE(label.value(QStringLiteral("archived")).toBool(), true);
        QCOMPARE(label.value(QStringLiteral("missing")).toBool(), false);
        // The core decides which words the label takes.
        QCOMPARE(label.value(QStringLiteral("kind")).toString(), QStringLiteral("named"));
        const QList<QVariantMap> projects = qdbus_cast<QList<QVariantMap>>(f.get(QStringLiteral("Projects")));
        for (const QVariantMap &project : projects) {
            QVERIFY(project.value(QStringLiteral("id")).toLongLong() != 99);
        }
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("ChosenProjectName")).contains(QStringLiteral("Legacy"));
        }));
    }

    // Pause asks the server to stop the running entry and keep the chain,
    // Resume starts its clone against the revision shown, and ChainSeconds
    // is what the server stored until Stop ends the chain. Running and
    // StartTime keep their meaning throughout.
    void pauseAndResume()
    {
        Fixture f;
        const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
        f.change(chainEntry(5, begin, std::nullopt));
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 0);
        // Nothing is paused, so there is nothing to resume.
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);

        qint64 total = 0;
        qint64 running = 5;
        for (const qint64 seconds : {qint64(60), qint64(300)}) {
            // Pause sends one request against the revision shown, and the
            // entry stops when the server says so.
            const qint64 pausedAt = f.revision;
            QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), true);
            const QList<qsizetype> pauses = f.find("POST", "/timer/pause");
            QCOMPARE(f.transport.requests.at(pauses.last()).body, json(revisionBody(pausedAt)));
            QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), false);
            QVERIFY(f.find("PATCH", "/stop").isEmpty());
            total += seconds;
            QVERIFY(f.answer("POST", "/timer/pause", f.change(QJsonValue::Null, pauseObject(true, total))));
            QVERIFY(f.serve());
            QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
            QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), total);
            QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
            QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
            QVERIFY(f.recorder.valuesOf(QStringLiteral("ChainSeconds")).contains(total));
            // The paused entry's project and billable flag stay on show and
            // cannot be chosen.
            QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);
            QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QStringLiteral("Beta"));
            QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), true);
            const qsizetype sent = f.transport.requests.size();
            QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(11)}).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(false)}).toBool(), false);
            QCOMPARE(f.transport.requests.size(), sent);

            // Resume sends the revision shown, and the server starts the clone.
            const qint64 shown = f.revision;
            const qsizetype before = f.find("POST", "/timer/resume").size();
            QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), true);
            const QList<qsizetype> resumes = f.find("POST", "/timer/resume");
            QCOMPARE(resumes.size(), before + 1);
            QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(resumes.last()).body).object(), revisionBody(shown));
            QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
            ++running;
            const QDateTime resumed = f.clock.now();
            QVERIFY(f.answer("POST", "/timer/resume", f.change(chainEntry(running, resumed, std::nullopt), pauseObject(false, total, running))));
            QVERIFY(f.serve());
            QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
            QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), resumed.toSecsSinceEpoch());
            QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
            QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), total);
        }

        // Stop while running stops the clone and ends the chain.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        const QList<qsizetype> stops = f.find("POST", "/app/timer/stop");
        QCOMPARE(stops.size(), 1);
        f.respond(stops.first(), FakeTransport::answer(200, f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 0);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ChainSeconds")).contains(qint64(0)));
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);
    }

    // Stop while paused asks the server to discard the chain against the
    // revision shown and changes nothing until the server answers. The next
    // Start begins a new chain.
    void stopWhilePausedDiscardsTheChain()
    {
        Fixture f;
        const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
        f.change(chainEntry(5, begin, std::nullopt));
        QVERIFY(f.start());
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), true);
        QVERIFY(f.answer("POST", "/timer/pause", f.change(QJsonValue::Null, pauseObject(true, 600))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 600);

        // Stop sends the discard against the revision shown and changes
        // nothing until the server answers.
        const qint64 shown = f.revision;
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        QList<qsizetype> discards = f.find("POST", "/timer/discard");
        QCOMPARE(discards.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(discards.first()).body).object(), revisionBody(shown));
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);

        // No answer: the chain stays and the discard is not sent again. A
        // read that follows settles it, and then Stop can be tried again.
        f.respond(discards.first(), FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("Host unreachable")));
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.find("POST", "/timer/discard").size(), 1);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        discards = f.find("POST", "/timer/discard");
        QCOMPARE(discards.size(), 2);
        QVERIFY(f.answer("POST", "/timer/discard", f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Paused")).contains(false));
        // Nothing is left to stop or resume, and the next start is plain.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);
    }

    // A 409 shows the state the server sent instead, and says why nothing
    // happened.
    void conflictShowsTheChangeFromAnotherDevice()
    {
        Fixture f;
        f.change(QJsonValue::Null, pauseObject(true, 65));
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);

        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), true);
        // Another device resumed first.
        const QDateTime resumed = f.clock.now().addSecs(-4);
        QVERIFY(f.answer("POST", "/timer/resume", f.change(chainEntry(6, resumed, std::nullopt), pauseObject(false, 65, 6)), 409));
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), resumed.toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("error"));
        const QString message = QStringLiteral("The timer changed on another device first.");
        QCOMPARE(f.get(QStringLiteral("ErrorString")).toString(), message);
        QVERIFY(QTest::qWaitFor([&f, &message] {
            return f.recorder.valuesOf(QStringLiteral("ErrorString")).contains(message);
        }));
    }

    void configureRefusesUnusableSettings_data()
    {
        QTest::addColumn<QString>("url");
        QTest::addColumn<QString>("authMode");
        QTest::addColumn<QString>("email");
        QTest::newRow("no address") << QString() << QStringLiteral("token") << QString();
        QTest::newRow("not http") << QStringLiteral("ftp://a.example.test") << QStringLiteral("token") << QString();
        QTest::newRow("user info") << QStringLiteral("https://bea:pw@a.example.test") << QStringLiteral("token") << QString();
        QTest::newRow("unknown method") << instanceUrl << QStringLiteral("magic") << QString();
        QTest::newRow("password without email") << instanceUrl << QStringLiteral("password") << QStringLiteral("  ");
    }

    void configureRefusesUnusableSettings()
    {
        QFETCH(QString, url);
        QFETCH(QString, authMode);
        QFETCH(QString, email);
        Fixture f;
        QVERIFY(f.start());
        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {url, authMode, email, QStringLiteral("secret")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), QStringLiteral("org.freedesktop.DBus.Error.InvalidArgs"));
        QVERIFY(!reply.errorMessage().contains(QStringLiteral("secret")));
        QCOMPARE(f.store.writes, 0);
        QVERIFY(!QFile::exists(f.settingsFile()));
        QCOMPARE(f.daemon->connection.instanceUrl(), QString());
    }

    // A refused secret leaves the settings as they were.
    void configureReportsCredentialStoreFailure()
    {
        Fixture f;
        QVERIFY(f.start());
        f.store.failure = CredentialResult::Status::Unavailable;
        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {instanceUrl, QStringLiteral("token"), QString(), QStringLiteral("tok-1")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), ConfigurationAdapter::credentialStoreError);
        QCOMPARE(reply.errorMessage(), f.store.message(CredentialResult{CredentialResult::Status::Unavailable, QString()}));
        QVERIFY(!QFile::exists(f.settingsFile()));
        QCOMPARE(f.daemon->connection.instanceUrl(), QString());
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("unconfigured"));
    }

    // A restarted service connects with the saved settings and the stored
    // secret; Configure with an empty secret keeps the stored one.
    void restoresSettings()
    {
        Fixture f;
        {
            QSettings settings(f.settingsFile(), QSettings::IniFormat);
            settings.setValue(QStringLiteral("instanceUrl"), instanceUrl);
            settings.setValue(QStringLiteral("authMode"), QStringLiteral("token"));
            settings.setValue(QStringLiteral("email"), QString());
        }
        f.store.secrets.insert(credentialKey(parseInstanceUrl(instanceUrl), AuthMode::Token, QString()), QStringLiteral("tok-saved"));
        QVERIFY(f.start());
        QCOMPARE(f.daemon->connection.instanceUrl(), instanceUrl);
        QVERIFY(f.serve());
        QCOMPARE(f.transport.requests.at(f.find("GET", "/me").first()).authorization,
                 basicAuthorization(AuthMode::Token, QString(), QStringLiteral("tok-saved")));

        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {instanceUrl, QStringLiteral("token"), QString(), QString()});
        QCOMPARE(reply.type(), QDBusMessage::ReplyMessage);
        QCOMPARE(f.store.writes, 0);
    }

    // Two Configure calls whose keyring writes end in the other order: the
    // later call's settings stay, whichever write ends last.
    void laterConfigureWins()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        FakeTransport transport;
        HeldStore store;
        FakeClock clock;
        const QString file = dir.filePath(QStringLiteral("tokkl-timerd.conf"));
        Daemon daemon(&transport, &store, file, &clock);
        QVERIFY(daemon.service.registerOn(QDBusConnection(serviceBus)));
        const QString other = QStringLiteral("https://b.example.test");
        QDBusPendingCall first = configureCall(instanceUrl, QStringLiteral("tok-a"));
        QTRY_COMPARE(store.held.size(), 1);
        QDBusPendingCall second = configureCall(other, QStringLiteral("tok-b"));
        QTRY_COMPARE(store.held.size(), 2);
        const QString expected = parseInstanceUrl(other).base.toString();

        store.finish(1);
        QCOMPARE(daemon.connection.instanceUrl(), expected);
        store.finish(0);
        QCOMPARE(daemon.connection.instanceUrl(), expected);
        const QSettings settings(file, QSettings::IniFormat);
        QCOMPARE(settings.value(QStringLiteral("instanceUrl")).toString(), expected);
        QTRY_VERIFY(first.isFinished() && second.isFinished());
    }

    // The replaced call says so: its settings were never
    // applied, so a client must not keep them as accepted.
    void replacedConfigureFailsAsSuperseded()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        FakeTransport transport;
        HeldStore store;
        FakeClock clock;
        Daemon daemon(&transport, &store, dir.filePath(QStringLiteral("tokkl-timerd.conf")), &clock);
        QVERIFY(daemon.service.registerOn(QDBusConnection(serviceBus)));
        const QString other = QStringLiteral("https://b.example.test");
        QDBusPendingCall first = configureCall(instanceUrl, QStringLiteral("tok-a"));
        QTRY_COMPARE(store.held.size(), 1);
        QDBusPendingCall second = configureCall(other, QStringLiteral("tok-b"));
        QTRY_COMPARE(store.held.size(), 2);

        store.finish(1);
        store.finish(0);
        QTRY_VERIFY(first.isFinished() && second.isFinished());
        QCOMPARE(second.reply().type(), QDBusMessage::ReplyMessage);
        QCOMPARE(first.reply().type(), QDBusMessage::ErrorMessage);
        QCOMPARE(first.reply().errorName(), ConfigurationAdapter::supersededError);
        QVERIFY(!first.reply().errorMessage().isEmpty());
        QCOMPARE(daemon.connection.instanceUrl(), parseInstanceUrl(other).base.toString());
    }

    // A second instance cannot take the name, as tokkl-timerd then exits.
    void secondInstanceRefused()
    {
        Fixture f;
        QVERIFY(f.start());
        FakeTransport transport;
        FakeCredentialStore store;
        SystemClock clock;
        Daemon second(&transport, &store, f.dir.filePath(QStringLiteral("second.conf")), &clock);
        QVERIFY(!second.service.registerOn(QDBusConnection(clientBus)));
        QCOMPARE(QDBusConnection(clientBus).interface()->serviceOwner(TimerService::serviceName).value(), QDBusConnection(serviceBus).baseService());
    }

    // A session started on another device shows in Timer mode, locks the
    // mode and takes the clicks: the menu before the planned end, Next phase
    // after it. Its actions go to the server against the revision shown, and
    // the state that follows shows the result.
    void sessionStartedElsewhereAppearsInTimerMode()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);

        const QDateTime begin = f.clock.now().addSecs(-10);
        QVERIFY(f.push(f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroObject(work(begin), 41))));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), false);
        // The open pomodoro belongs to the session, not to the timer.
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PhaseStart")).toLongLong(), begin.toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), begin.addSecs(60).toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 1);
        QCOMPARE(f.get(QStringLiteral("LongRestEvery")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("SessionActive")).contains(true));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ModeLocked")).contains(true));

        // The timer is the session's while it runs.
        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        // Before the planned end a click opens the menu.
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("open-menu"));
        QCOMPARE(f.transport.requests.size(), sent);

        // After it the click confirms Next phase against the revision shown.
        f.advance(50);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QStringLiteral("workToShortRest"));
        const qint64 shown = f.revision;
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        const QList<qsizetype> nexts = f.find("POST", "/pomodoro/next");
        QCOMPARE(nexts.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(nexts.first()).body).object(), revisionBody(shown));
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        const QDateTime rest = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroObject(shortRest(rest, begin), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("work"));

        // The menu's End session goes to the server too.
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        const QList<qsizetype> ends = f.find("POST", "/pomodoro/end");
        QCOMPARE(ends.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(ends.first()).body).object(), revisionBody(f.revision));
        QVERIFY(f.answer("POST", "/pomodoro/end", f.change(QJsonValue::Null)));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        // The server saves the pomodoros: the service sends no entry.
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
    }

    // A session ended on another device leaves the timer free again.
    void sessionEndedElsewhereFreesTheTimer()
    {
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-10);
        f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroObject(work(begin), 41));
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);

        QVERIFY(f.push(f.change(QJsonValue::Null)));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), 0);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
    }

    // Pomodoro mode is stored and locks while a session runs. The session is
    // the server's: Start session, Next phase and End session go to it, the
    // planned end rings with the chosen sound for the player, and a restart
    // reads the session again.
    void pomodoroSessionOverTheBus()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("PhaseStart")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 0);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QString());
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}).toBool(), true);
        FakeAlarmOutput output;
        PomodoroAlarm alarm(&f.daemon->session, &output, &f.daemon->sounds, bundledSoundsDir());

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroMode")).contains(true));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("CanStartSession")).contains(true));
        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Pomodoro/pomodoroMode")).toBool(), true);
        }
        // Start is refused in Pomodoro mode and sends nothing.
        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);

        // Start session sends the chosen project, and the server starts the
        // session with the account's lengths.
        const QDateTime at = f.clock.now();
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        const QList<qsizetype> starts = f.find("POST", "/pomodoro");
        QCOMPARE(starts.size(), 1);
        const QJsonObject startBody = QJsonDocument::fromJson(f.transport.requests.at(starts.first()).body).object();
        QCOMPARE(startBody.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
        QCOMPARE(startBody.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(startBody.value(QStringLiteral("workspace_id")).toInteger(), 7);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(work(at), 41))));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PhaseStart")).toLongLong(), at.toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), at.addSecs(60).toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 1);
        QCOMPARE(f.get(QStringLiteral("LongRestEvery")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("SessionActive")).contains(true);
        }));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Phase")).contains(QStringLiteral("work")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PhaseStart")).contains(at.toSecsSinceEpoch()));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PlannedEnd")).contains(at.addSecs(60).toSecsSinceEpoch()));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroNumber")).contains(1));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("UpcomingPhase")).contains(QStringLiteral("shortRest")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ModeLocked")).contains(true));
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        // The open pomodoro is the session's: Project and Billable are locked,
        // in Actions and in the methods.
        const qsizetype requests = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(false)}).toBool(), false);
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.service->actions().value(QStringLiteral("project")).value(QStringLiteral("enabled")).toBool(), false);
        QCOMPARE(f.service->actions().value(QStringLiteral("billable")).value(QStringLiteral("enabled")).toBool(), false);

        // The countdown is not published; the planned end is, as Ringing,
        // and the player hears the sound chosen for the transition.
        f.advance(59);
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Ringing")).isEmpty());
        QVERIFY(output.calls.isEmpty());
        f.advance(1);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QStringLiteral("workToShortRest"));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("Ringing")).contains(true);
        }));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("RingingTransition")).contains(QStringLiteral("workToShortRest")));
        QCOMPARE(output.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("long-rest-to-work"))});

        // Next phase asks the server, which starts the rest; the alarm
        // rings on until the state shows it.
        const qint64 shown = f.revision;
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(f.find("POST", "/pomodoro/next").first()).body).object(), revisionBody(shown));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(output.calls.size(), 1);
        const QDateTime rest = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(shortRest(rest, at), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QString());
        QCOMPARE(output.calls.size(), 2);
        QCOMPARE(output.calls.last(), QStringLiteral("stop"));

        // Rest to work: the server saves the pomodoro, the service sends no entry.
        f.advance(61);
        QVERIFY(f.serve());
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        const QDateTime second = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(42, second, std::nullopt), QJsonValue::Null, pomodoroObject(work(second, 1), 42))));
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("longRest"));

        // A restarted service reads the session from the server.
        QVERIFY(f.restart());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);

        // End session asks the server and unlocks the mode.
        f.advance(90);
        QVERIFY(f.serve());
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro/end", f.change(QJsonValue::Null)));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), 0);
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
    }

    // A pomodoro the server dropped as too short is reported as
    // SessionMessage, and so is the reason the server refused an action.
    void sessionMessageIsPublished()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);

        // A refused start says why, and the session can be started again
        // once the read after it has answered.
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro", errorBody("Project not found"), 404));
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QStringLiteral("Project not found"));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("SessionMessage")).contains(QStringLiteral("Project not found"));
        }));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), true);

        // The next action clears it.
        const QDateTime at = f.clock.now();
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QString());
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(work(at), 41))));
        f.advance(10);
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        const QJsonObject discarded{
            {QStringLiteral("entry_id"), 41},
            {QStringLiteral("start"), iso(at)},
            {QStringLiteral("stop"), iso(f.clock.now())},
        };
        QVERIFY(f.answer("POST", "/pomodoro/end", f.change(QJsonValue::Null, QJsonValue::Null, QJsonValue::Null, discarded)));
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
        const QString message = f.get(QStringLiteral("SessionMessage")).toString();
        QVERIFY(!message.isEmpty());
        QVERIFY(QTest::qWaitFor([&f, &message] {
            return f.recorder.valuesOf(QStringLiteral("SessionMessage")).contains(message);
        }));
    }

    // Actions carries the core's menu rules with the GNOME policy, and its
    // changes reach the bus like any other property's.
    void actionsFollowTheCore()
    {
        Fixture f;
        QVERIFY(f.start());
        const auto action = [&f](const QString &name) {
            return f.service->actions().value(name);
        };
        QCOMPARE(f.service->actions().keys(),
                 (QStringList{QStringLiteral("billable"),
                              QStringLiteral("endSession"),
                              QStringLiteral("mode"),
                              QStringLiteral("nextPhase"),
                              QStringLiteral("project"),
                              QStringLiteral("run"),
                              QStringLiteral("startSession")}));
        QCOMPARE(action(QStringLiteral("run")).value(QStringLiteral("visible")).toBool(), true);
        QCOMPARE(action(QStringLiteral("run")).value(QStringLiteral("enabled")).toBool(), false);
        QCOMPARE(action(QStringLiteral("run")).value(QStringLiteral("label")).toString(), QStringLiteral("start"));
        QCOMPARE(action(QStringLiteral("mode")).value(QStringLiteral("enabled")).toBool(), true);

        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("ready"));
        QCOMPARE(action(QStringLiteral("run")).value(QStringLiteral("enabled")).toBool(), true);
        QCOMPARE(action(QStringLiteral("project")).value(QStringLiteral("enabled")).toBool(), true);
        QCOMPARE(action(QStringLiteral("project")).value(QStringLiteral("label")).toString(), QStringLiteral("project"));
        QVERIFY(QTest::qWaitFor([&f] {
            return !f.recorder.valuesOf(QStringLiteral("Actions")).isEmpty();
        }));

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(action(QStringLiteral("run")).value(QStringLiteral("visible")).toBool(), false);
        QCOMPARE(action(QStringLiteral("startSession")).value(QStringLiteral("visible")).toBool(), true);
        QCOMPARE(action(QStringLiteral("startSession")).value(QStringLiteral("enabled")).toBool(), true);
        // The last Actions the bus saw shows Start session.
        QVERIFY(QTest::qWaitFor([&f] {
            const QVariantList published = f.recorder.valuesOf(QStringLiteral("Actions"));
            return !published.isEmpty()
                && qdbus_cast<QMap<QString, QVariantMap>>(published.last()).value(QStringLiteral("startSession")).value(QStringLiteral("visible")).toBool();
        }));
        const auto last = qdbus_cast<QMap<QString, QVariantMap>>(f.recorder.valuesOf(QStringLiteral("Actions")).last());
        QCOMPARE(last.value(QStringLiteral("startSession")).value(QStringLiteral("visible")).toBool(), true);
    }

    // Presentation carries the core's StatusPresentation with the GNOME
    // policy, and its changes reach the bus like any other property's.
    void presentationFollowsTheCore()
    {
        Fixture f;
        QVERIFY(f.start());
        const auto parts = [](const QVariantMap &presentation, const char *key) {
            return presentation.value(QString::fromLatin1(key)).toStringList();
        };
        QVariantMap shown = qdbus_cast<QVariantMap>(f.get(QStringLiteral("Presentation")));
        QCOMPARE(parts(shown, "summary"),
                 (QStringList{QStringLiteral("activity"), QStringLiteral("project"), QStringLiteral("connection"), QStringLiteral("detail")}));
        QCOMPARE(parts(shown, "menuLine"), QStringList{QStringLiteral("connection")});
        QCOMPARE(shown.value(QStringLiteral("mark")).toString(), QStringLiteral("unconfigured"));

        QVERIFY(f.connect());
        QCOMPARE(f.service->presentation(), StatusPresentation::of(StatusInput::of(f.daemon->timer, &f.daemon->session), StatusPolicy::gnome()).toVariantMap());
        shown = qdbus_cast<QVariantMap>(f.get(QStringLiteral("Presentation")));
        QCOMPARE(parts(shown, "summary"), (QStringList{QStringLiteral("activity"), QStringLiteral("project"), QStringLiteral("connection")}));
        QCOMPARE(shown.value(QStringLiteral("mark")).toString(), QStringLiteral("none"));
        QVERIFY(QTest::qWaitFor([&f] {
            const QVariantList published = f.recorder.valuesOf(QStringLiteral("Presentation"));
            return !published.isEmpty() && qdbus_cast<QVariantMap>(published.last()).value(QStringLiteral("mark")).toString() == QLatin1String("none");
        }));

        // Pomodoro mode joins the summary.
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QVERIFY(QTest::qWaitFor([&f] {
            const QVariantList published = f.recorder.valuesOf(QStringLiteral("Presentation"));
            return !published.isEmpty()
                && qdbus_cast<QVariantMap>(published.last()).value(QStringLiteral("summary")).toStringList().contains(QStringLiteral("pomodoroMode"));
        }));
    }

    // Activate: in Timer mode, and while an entry runs or a chain is
    // paused, it toggles the timer (start, pause, resume); in Pomodoro mode
    // it starts a session, is ignored while that waits for the server or
    // without an account, opens the menu during a phase, and confirms the
    // next phase while ringing.
    void activateInEachBranch()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), true);
        // The timer's toggle without an account sends nothing either.
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        // A click while the start waits for its answer applies nothing.
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);
        QVERIFY(f.answer("POST", "/app/timer/start", f.change(entryObject(5, 11, true))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QCOMPARE(f.find("POST", "/timer/pause").size(), 1);
        QVERIFY(f.answer("POST", "/timer/pause", f.change(QJsonValue::Null, pauseObject(true, 65))));
        QVERIFY(f.serve());
        // The click paused the chain, which locks the mode too; Stop while
        // paused discards it.
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        QVERIFY(f.answer("POST", "/timer/discard", f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ModeLocked")).contains(true));

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        const QDateTime at = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(work(at), 41))));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("open-menu"));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        f.advance(60);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(shortRest(f.clock.now(), at), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);
    }

    // The lengths follow the account; a save sends only what differs, and
    // the server's refusals show per length or as the general error.
    // The limits are the core's, keyed as PomodoroLengths, so the
    // extension's controls need no copy of them.
    void pomodoroLengthLimitsAreTheCores()
    {
        Fixture f;
        QVERIFY(f.start());
        const auto published = [&f] {
            return qdbus_cast<QMap<QString, IntMap>>(f.get(QStringLiteral("PomodoroLengthLimits")).value<QDBusArgument>());
        };
        // Before a server announced any, the core's placeholder.
        QCOMPARE(published().value(QStringLiteral("work")).value(QStringLiteral("max")), PomodoroLimits::placeholder().workMinutes.max);
        QVERIFY(f.connect());
        QTRY_COMPARE(published().value(QStringLiteral("work")).value(QStringLiteral("max")), 180);
        const QMap<QString, IntMap> limits = published();
        const QVariantMap core = decodeServerApi(currentServerApi()).pomodoroLimits->toVariantMap();
        const StringMap names{
            {QStringLiteral("work"), QStringLiteral("workMinutes")},
            {QStringLiteral("shortRest"), QStringLiteral("shortRestMinutes")},
            {QStringLiteral("longRest"), QStringLiteral("longRestMinutes")},
            {QStringLiteral("longRestEvery"), QStringLiteral("longRestEvery")},
        };
        QCOMPARE(limits.keys(), names.keys());
        for (auto it = names.cbegin(); it != names.cend(); ++it) {
            const QVariantMap limit = core.value(it.value()).toMap();
            const IntMap expected{
                {QStringLiteral("min"), limit.value(QStringLiteral("min")).toInt()},
                {QStringLiteral("max"), limit.value(QStringLiteral("max")).toInt()},
                {QStringLiteral("default"), limit.value(QStringLiteral("default")).toInt()},
            };
            QCOMPARE(limits.value(it.key()), expected);
        }
        QCOMPARE(limits.value(QStringLiteral("longRestEvery")).value(QStringLiteral("default")), 4);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroLengthLimits")).size() >= 1);
    }

    void pomodoroLengthsOverTheBus()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.get(QStringLiteral("PomodoroLengthsEditable")).toBool(), false);
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap(PomodoroConfig()));
        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {2, 1, 1, 2}).toBool(), false);
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("PomodoroLengthsEditable")).toBool(), true);
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap(lengths));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("PomodoroLengthsEditable")).contains(true);
        }));
        QVERIFY(!f.recorder.valuesOf(QStringLiteral("PomodoroLengths")).isEmpty());
        QCOMPARE(qdbus_cast<IntMap>(f.recorder.valuesOf(QStringLiteral("PomodoroLengths")).last()), lengthsMap(lengths));

        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {200, 1, 1, 2}).toBool(), true);
        QList<qsizetype> saves = f.find("POST", "/me/preferences");
        QCOMPARE(saves.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(saves.first()).body).object(),
                 QJsonObject({{QStringLiteral("pomodoro_focus_interval_in_minutes"), 200}}));
        // Nothing else is sent while the save runs.
        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {2, 1, 1, 2}).toBool(), false);
        const QString refused = QStringLiteral("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180");
        HttpResponse refusal = FakeTransport::answer(400, errorBody("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180"));
        refusal.errorField = "pomodoro_focus_interval_in_minutes";
        f.respond(saves.first(), refusal);
        const StringMap workError{{QStringLiteral("work"), refused}};
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))), workError);
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap(lengths));
        QVERIFY(QTest::qWaitFor([&f] {
            return !f.recorder.valuesOf(QStringLiteral("PomodoroLengthErrors")).isEmpty();
        }));
        QCOMPARE(qdbus_cast<StringMap>(f.recorder.valuesOf(QStringLiteral("PomodoroLengthErrors")).last()), workError);

        // Nothing differs, nothing is sent.
        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {1, 1, 1, 2}).toBool(), false);
        QCOMPARE(f.find("POST", "/me/preferences").size(), 1);

        // An accepted save shows the new lengths and clears the error.
        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {2, 1, 1, 2}).toBool(), true);
        saves = f.find("POST", "/me/preferences");
        QCOMPARE(saves.size(), 2);
        f.respond(saves.last(), FakeTransport::answer(200, preferencesBody({2, 1, 1, 2})));
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap({2, 1, 1, 2}));
        QVERIFY(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))).isEmpty());
        QVERIFY(QTest::qWaitFor([&f] {
            return qdbus_cast<IntMap>(f.recorder.valuesOf(QStringLiteral("PomodoroLengths")).last()) == lengthsMap({2, 1, 1, 2});
        }));
        QVERIFY(qdbus_cast<StringMap>(f.recorder.valuesOf(QStringLiteral("PomodoroLengthErrors")).last()).isEmpty());

        // A refusal that names no length is the general error.
        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {2, 1, 1, 3}).toBool(), true);
        f.respond(f.find("POST", "/me/preferences").last(), FakeTransport::answer(400, errorBody("Preferences are too large")));
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))),
                 (StringMap{{QStringLiteral("general"), QStringLiteral("Preferences are too large")}}));

        // RefreshPreferences reads the lengths again.
        const qsizetype reads = f.find("GET", "/me/preferences").size();
        QCOMPARE(f.timer(QStringLiteral("RefreshPreferences")).type(), QDBusMessage::ReplyMessage);
        const QList<qsizetype> found = f.find("GET", "/me/preferences");
        QCOMPARE(found.size(), reads + 1);
        f.respond(found.last(), FakeTransport::answer(200, preferencesBody({3, 1, 1, 3})));
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap({3, 1, 1, 3}));
        QVERIFY(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))).isEmpty());
    }

    // Each transition plays its namesake until SetSound chooses another,
    // which the settings file keeps across a restart. Unknown transitions
    // and ids are invalid arguments. A preview reaches the player as a Qt
    // signal and is refused without one.
    void soundsOverTheBus()
    {
        Fixture f;
        QVERIFY(f.start());
        const StringMap defaults{
            {QStringLiteral("workToShortRest"), QStringLiteral("work-to-short-rest")},
            {QStringLiteral("shortRestToWork"), QStringLiteral("short-rest-to-work")},
            {QStringLiteral("workToLongRest"), QStringLiteral("work-to-long-rest")},
            {QStringLiteral("longRestToWork"), QStringLiteral("long-rest-to-work")},
        };
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), defaults);
        const QList<QVariantMap> choices = qdbus_cast<QList<QVariantMap>>(f.get(QStringLiteral("SoundChoices")));
        const QList<PomodoroSound> catalogue = pomodoroSounds();
        QCOMPARE(choices.size(), catalogue.size());
        for (qsizetype i = 0; i < choices.size(); ++i) {
            QCOMPARE(choices.at(i).value(QStringLiteral("id")).toString(), catalogue.at(i).id);
            QCOMPARE(choices.at(i).value(QStringLiteral("label")).toString(), catalogue.at(i).label);
            QVERIFY(!catalogue.at(i).label.isEmpty());
        }

        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}).toBool(), true);
        StringMap chosen = defaults;
        chosen.insert(QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work"));
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), chosen);
        QVERIFY(QTest::qWaitFor([&f] {
            return !f.recorder.valuesOf(QStringLiteral("Sounds")).isEmpty();
        }));
        QCOMPARE(qdbus_cast<StringMap>(f.recorder.valuesOf(QStringLiteral("Sounds")).last()), chosen);

        QDBusMessage reply = f.timer(QStringLiteral("SetSound"), {QStringLiteral("bogus"), QStringLiteral("long-rest-to-work")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), invalidArgs);
        reply = f.timer(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("bogus")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), invalidArgs);
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), chosen);
        reply = f.timer(QStringLiteral("PreviewSound"), {QStringLiteral("bogus")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), invalidArgs);

        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), false);
        FakeAlarmOutput output;
        PomodoroAlarm alarm(&f.daemon->session, &output, &f.daemon->sounds, bundledSoundsDir());
        f.service->setAlarm(&alarm);
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        QCOMPARE(output.calls, QStringList{QStringLiteral("once ") + bundled(QStringLiteral("short-rest-to-work"))});

        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Sounds/workToShortRest")).toString(), QStringLiteral("long-rest-to-work"));
        }
        QVERIFY(f.restart());
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), chosen);
    }

    // A sound the output could not play, or whose file is missing, shows in
    // AlarmError until the next sound starts.
    void alarmErrorTellsWhyNoSoundPlayed()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QString());
        FakeAlarmOutput output;
        PomodoroAlarm alarm(&f.daemon->session, &output, &f.daemon->sounds, bundledSoundsDir());
        f.service->setAlarm(&alarm);
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        output.fail(QStringLiteral("Connection refused"));
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QStringLiteral("No alarm sound: Connection refused"));
        QTRY_VERIFY(f.recorder.valuesOf(QStringLiteral("AlarmError")).contains(QStringLiteral("No alarm sound: Connection refused")));

        // The next sound starts afresh.
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QString());

        // A file that is not there plays nothing and says so.
        QTemporaryDir empty;
        QVERIFY(empty.isValid());
        alarm.setSoundsDirectory(empty.path());
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(output.calls.size(), 2);
        const QString missing = f.get(QStringLiteral("AlarmError")).toString();
        QVERIFY2(missing.startsWith(QStringLiteral("No alarm sound: ")) && missing.contains(empty.path()), qPrintable(missing));
    }

    // The alarm loops the file of the sound chosen for the ringing
    // transition, follows a change of choice while ringing, stops on Next
    // phase and on End session, and plays a preview once; once the service
    // has it, PreviewSound is accepted. An alarm made while one rings starts
    // at once.
    void alarmPlayerDrivesTheBackend()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), false);
        FakeAlarmOutput backend;
        PomodoroAlarm player(&f.daemon->session, &backend, &f.daemon->sounds, bundledSoundsDir());
        f.service->setAlarm(&player);
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        QCOMPARE(backend.calls, QStringList{QStringLiteral("once ") + bundled(QStringLiteral("short-rest-to-work"))});
        backend.calls.clear();

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        const QDateTime at = f.clock.now();
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(work(at), 41))));
        f.advance(59);
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QVERIFY(backend.calls.isEmpty());
        f.advance(1);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(backend.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("long-rest-to-work"))});
        // Choosing another sound for the ringing transition switches the loop.
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(backend.calls.last(), QStringLiteral("loop ") + bundled(QStringLiteral("work-to-long-rest")));
        // A choice for another transition changes nothing.
        backend.calls.clear();
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("longRestToWork"), QStringLiteral("work-to-short-rest")}).toBool(), true);
        QVERIFY(backend.calls.isEmpty());
        // A second player hears the alarm that already rings.
        FakeAlarmOutput late;
        PomodoroAlarm latePlayer(&f.daemon->session, &late, &f.daemon->sounds, bundledSoundsDir());
        QCOMPARE(late.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("work-to-long-rest"))});

        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroObject(shortRest(f.clock.now(), at), 41))));
        QCOMPARE(backend.calls, QStringList{QStringLiteral("stop")});
        QCOMPARE(late.calls.last(), QStringLiteral("stop"));
        backend.calls.clear();
        f.advance(60);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QStringLiteral("shortRestToWork"));
        QCOMPARE(backend.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("short-rest-to-work"))});
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro/end", f.change(QJsonValue::Null)));
        QCOMPARE(backend.calls.last(), QStringLiteral("stop"));
        QCOMPARE(backend.calls.size(), 2);
        // A preview while silent plays once and leaves no loop behind.
        backend.calls.clear();
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(backend.calls, QStringList{QStringLiteral("once ") + bundled(QStringLiteral("work-to-long-rest"))});
    }

private:
    QTemporaryDir m_home;
    PrivateBus m_bus;
};

QTEST_GUILESS_MAIN(TimerServiceTest)
#include "timerservicetest.moc"
