#include "alarmoutput.h"
#include "pomodoroalarm.h"
#include "statuspresentation.h"
#include "apitypes.h"
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
#include "timerstack.h"
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
using IntMap = QMap<QString, int>;
using StringMap = QMap<QString, QString>;
const PomodoroConfig lengths{1, 1, 1, 2};

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

const QByteArray projectsBody = json(QJsonArray{
    projectObject(11, QStringLiteral("Alpha"), QStringLiteral("#06aaf5"), true),
    projectObject(12, QStringLiteral("Beta"), QStringLiteral("#d94182"), false),
});

IntMap lengthsMap(const PomodoroConfig &config)
{
    return {
        {QStringLiteral("work"), config.workMinutes},
        {QStringLiteral("shortRest"), config.shortRestMinutes},
        {QStringLiteral("longRest"), config.longRestMinutes},
        {QStringLiteral("longRestEvery"), config.longRestEvery},
    };
}

QByteArray latestBody()
{
    QJsonObject entry = entryObject(4, 11, false, true);
    entry.insert(QStringLiteral("project_active"), true);
    entry.insert(QStringLiteral("project_billable"), true);
    return json(entry);
}

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

QJsonObject revisionBody(qint64 revision)
{
    return QJsonObject{{QStringLiteral("revision"), revision}};
}

struct Interface {
    StringMap properties; // name -> "type access"
    QMap<QString, QStringList> methods; // name -> "direction type" per argument
    QSet<QString> signalNames;
};

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

class ChangeRecorder : public QObject
{
    Q_OBJECT

public:
    QList<QVariantMap> changes;
    QList<QVariantList> finished;

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

    void fail(const QString &reason)
    {
        reportFailure(reason);
    }
};

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

// main.cpp's object graph, built in the same order.
struct Daemon {
    Daemon(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock)
        : settings(settingsFile, QSettings::IniFormat)
        , pomodoroStore(&settings)
        , stack(transport, store, pomodoroStore, *clock, TimerService::clientName())
        , connection(*stack.connection())
        , timer(*stack.timer())
        , session(*stack.session())
        , sounds(&settings, &TimerService::soundKey)
        , connectionSettings(&settings, &connection, store)
        , alarm(session, output, sounds, bundledSoundsDir())
        , service({&timer, &session, stack.preferences(), &sounds, &connectionSettings, &alarm})
    {
        connectionSettings.load();
    }

    QSettings settings;
    SettingsPomodoroStore pomodoroStore;
    TimerStack stack;
    Connection &connection;
    TimerController &timer;
    PomodoroSession &session;
    SoundChoices sounds;
    ServiceSettings connectionSettings;
    FakeAlarmOutput output;
    PomodoroAlarm alarm;
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
        QJsonValue running = QJsonValue::Null;
        QJsonValue chain = QJsonValue::Null;
        QJsonValue session = QJsonValue::Null;
        QJsonValue dropped = QJsonValue::Null;
        qint64 revision = 1;
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

        // As a tokkl-timerd restart on the same settings file.
        bool restart()
        {
            service = nullptr;
            daemon.reset();
            daemon = std::make_unique<Daemon>(&transport, &store, settingsFile(), &clock);
            service = &daemon->service;
            return service->registerOn(QDBusConnection(serviceBus)) && ping();
        }

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

        QByteArray change(const QJsonValue &runningEntry, const QJsonValue &pauseChain = QJsonValue::Null, const QJsonValue &pomodoro = QJsonValue::Null, const QJsonValue &discardedPomodoro = QJsonValue::Null)
        {
            running = runningEntry;
            chain = pauseChain;
            session = pomodoro;
            dropped = discardedPomodoro;
            ++revision;
            return state();
        }

        bool push(const QByteArray &state)
        {
            FakeStream *stream = transport.lastStream();
            if (!stream) {
                return false;
            }
            stream->push("event: timer\ndata: " + state + "\n\n");
            return true;
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

        void respond(qsizetype index, const HttpResponse &response)
        {
            answered.insert(index);
            transport.respond(index, response);
        }

        bool answer(const QByteArray &method, const QByteArray &suffix, const QByteArray &body, int status = 200)
        {
            const QList<qsizetype> found = find(method, suffix);
            if (found.isEmpty()) {
                return false;
            }
            respond(found.last(), FakeTransport::answer(status, body));
            return true;
        }

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
                        body = meBody();
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
        for (const QVariantMap &change : std::as_const(f.recorder.changes)) {
            QVERIFY(!change.isEmpty());
        }
    }

    void changesArriveOncePerTurn()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QFile file(QStringLiteral(TOKKL_TIMER1_XML));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QStringList names = parseIntrospection(file.readAll()).value(TimerService::interfaceName).properties.keys();
        // Containers arrive as QDBusArgument, so only plain values compare.
        const auto plain = [](const QVariant &value) {
            return value.metaType() != QMetaType::fromType<QDBusArgument>();
        };
        QVariantMap before;
        for (const QString &name : names) {
            before.insert(name, f.get(name));
        }
        QVERIFY(f.ping());
        const qsizetype published = f.recorder.changes.size();

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

    void projectRulesAndClientName()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(12)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);
        QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("IndicatorColor")).toString(), QStringLiteral("#d94182"));
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(999)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);

        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        const QList<qsizetype> starts = f.find("POST", "/app/timer/start");
        QCOMPARE(starts.size(), 1);
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(starts.first()).body).object();
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
        QCOMPARE(body.value(QStringLiteral("revision")).toInteger(), f.revision);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);

        f.respond(starts.first(), FakeTransport::answer(200, f.change(entryObject(5, 12, true))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        const qint64 start = QDateTime::fromString(startedAt, Qt::ISODate).toSecsSinceEpoch();
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), start);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Running")).contains(true));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("StartTime")).contains(start));

        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(11)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);

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
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("none"));
    }

    void requestsReportTheirEnd()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        const auto requestOf = [](const QVariant &value) {
            return value.toULongLong();
        };

        const qulonglong refusedStart = requestOf(f.result(QStringLiteral("RequestStart")));
        QVERIFY(refusedStart > 0);
        QCOMPARE(requestOf(f.result(QStringLiteral("RequestStart"))), 0ULL);
        const QList<qsizetype> starts = f.find("POST", "/app/timer/start");
        QCOMPARE(starts.size(), 1);
        f.respond(starts.first(), FakeTransport::answer(400, errorBody("Project is archived")));
        QTRY_COMPARE(f.recorder.finished.size(), 1);
        QCOMPARE(f.recorder.finished.last(), (QVariantList{refusedStart, false, QStringLiteral("Project is archived")}));
        // ErrorString had the words before the signal came.
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ErrorString")).contains(QStringLiteral("Project is archived")));

        const qulonglong start = requestOf(f.result(QStringLiteral("RequestStart")));
        QVERIFY(start > refusedStart);
        f.respond(f.find("POST", "/app/timer/start").last(), FakeTransport::answer(200, f.change(entryObject(5, 11, true))));
        QTRY_COMPARE(f.recorder.finished.size(), 2);
        QCOMPARE(f.recorder.finished.last(), (QVariantList{start, true, QString()}));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);

        const qulonglong pause = requestOf(f.result(QStringLiteral("RequestPause")));
        QVERIFY(pause > start);
        f.respond(f.find("POST", "/app/timer/pause").last(), FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QTRY_COMPARE(f.recorder.finished.size(), 3);
        QCOMPARE(f.recorder.finished.last().at(0).toULongLong(), pause);
        QCOMPARE(f.recorder.finished.last().at(1).toBool(), false);
        QVERIFY(!f.recorder.finished.last().at(2).toString().isEmpty());
        QVERIFY(f.serve());

        QCOMPARE(requestOf(f.result(QStringLiteral("RequestResume"))), 0ULL);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        f.respond(f.find("POST", "/app/timer/stop").last(), FakeTransport::answer(200, f.change(QJsonValue::Null)));
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QCOMPARE(f.recorder.finished.size(), 3);
    }

    // The server's clock runs 90 s ahead of this machine's.
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

        f.clock.current = f.clock.current.addSecs(60);
        f.serverAheadMs = 30000;
        QVERIFY(f.push(f.state()));
        QTRY_VERIFY(f.recorder.valuesOf(QStringLiteral("LocalStartTime")).contains(start - 30));
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), start);
        QCOMPARE(f.clock.now().toSecsSinceEpoch() - (start - 30), f.daemon->timer.elapsedSeconds());

        QVERIFY(f.push(f.change(QJsonValue::Null)));
        QTRY_COMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("LocalStartTime")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), 0);
    }

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
        QCOMPARE(f.service->projects().size(), Connection::maxProjectPages * Connection::projectPageSize);
    }

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
        const QVariantMap label = qdbus_cast<QVariantMap>(f.get(QStringLiteral("ChosenProjectLabel")));
        QCOMPARE(label.value(QStringLiteral("name")).toString(), QStringLiteral("Legacy"));
        QCOMPARE(label.value(QStringLiteral("archived")).toBool(), true);
        QCOMPARE(label.value(QStringLiteral("missing")).toBool(), false);
        QCOMPARE(label.value(QStringLiteral("kind")).toString(), QStringLiteral("named"));
        const QList<QVariantMap> projects = qdbus_cast<QList<QVariantMap>>(f.get(QStringLiteral("Projects")));
        for (const QVariantMap &project : projects) {
            QVERIFY(project.value(QStringLiteral("id")).toLongLong() != 99);
        }
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("ChosenProjectName")).contains(QStringLiteral("Legacy"));
        }));
    }

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
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);

        qint64 total = 0;
        qint64 running = 5;
        for (const qint64 seconds : {qint64(60), qint64(300)}) {
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
            QCOMPARE(f.get(QStringLiteral("ChosenProject")).toLongLong(), 12);
            QCOMPARE(f.get(QStringLiteral("ChosenProjectName")).toString(), QStringLiteral("Beta"));
            QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), true);
            const qsizetype sent = f.transport.requests.size();
            QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(11)}).toBool(), false);
            QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(false)}).toBool(), false);
            QCOMPARE(f.transport.requests.size(), sent);

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

        const qint64 shown = f.revision;
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        QList<qsizetype> discards = f.find("POST", "/timer/discard");
        QCOMPARE(discards.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(discards.first()).body).object(), revisionBody(shown));
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);

        // No answer: the chain stays until a follow-up read settles it.
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
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);
    }

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

    // A ServiceSettings refusal answers InvalidArgs; servicesettingstest has the cases.
    void configureRefusesUnusableSettings()
    {
        Fixture f;
        QVERIFY(f.start());
        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {QStringLiteral("ftp://a.example.test"), QStringLiteral("token"), QString(), QStringLiteral("secret")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), QStringLiteral("org.freedesktop.DBus.Error.InvalidArgs"));
        QVERIFY(!reply.errorMessage().contains(QStringLiteral("secret")));
        QCOMPARE(f.store.writes, 0);
        QVERIFY(!QFile::exists(f.settingsFile()));
        QCOMPARE(f.daemon->connection.instanceUrl(), QString());
    }

    void configureReportsCredentialStoreFailure()
    {
        Fixture f;
        QVERIFY(f.start());
        f.store.failure = CredentialResult::Status::Unavailable;
        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {instanceUrl, QStringLiteral("token"), QString(), QStringLiteral("tok-1")});
        QCOMPARE(reply.type(), QDBusMessage::ErrorMessage);
        QCOMPARE(reply.errorName(), TimerService::credentialStoreError);
        QCOMPARE(reply.errorMessage(), f.store.message(CredentialResult{CredentialResult::Status::Unavailable, QString()}));
        QVERIFY(!QFile::exists(f.settingsFile()));
        QCOMPARE(f.daemon->connection.instanceUrl(), QString());
        QCOMPARE(f.get(QStringLiteral("Status")).toString(), QStringLiteral("unconfigured"));
    }

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
    }

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
        QCOMPARE(first.reply().errorName(), TimerService::supersededError);
        QVERIFY(!first.reply().errorMessage().isEmpty());
        QCOMPARE(daemon.connection.instanceUrl(), parseInstanceUrl(other).base.toString());
    }

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

    void sessionStartedElsewhereAppearsInTimerMode()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);

        const QDateTime begin = f.clock.now().addSecs(-10);
        QVERIFY(f.push(f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroJson(work(begin), 41))));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), false);
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

        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("open-menu"));
        QCOMPARE(f.transport.requests.size(), sent);

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
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroJson(shortRest(rest, begin), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("work"));

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

    void sessionEndedElsewhereFreesTheTimer()
    {
        Fixture f;
        const QDateTime begin = f.clock.now().addSecs(-10);
        f.change(chainEntry(41, begin, std::nullopt), QJsonValue::Null, pomodoroJson(work(begin), 41));
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
        const FakeAlarmOutput &output = f.daemon->output;

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroMode")).contains(true));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("CanStartSession")).contains(true));
        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Pomodoro/pomodoroMode")).toBool(), true);
        }
        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);

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
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(work(at), 41))));
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
        const qsizetype requests = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("SetProject"), {qint64(0)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(false)}).toBool(), false);
        QCOMPARE(f.transport.requests.size(), requests);
        QCOMPARE(f.service->actions().value(QStringLiteral("project")).value(QStringLiteral("enabled")).toBool(), false);
        QCOMPARE(f.service->actions().value(QStringLiteral("billable")).value(QStringLiteral("enabled")).toBool(), false);

        // The countdown is not published, only the planned end.
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

        const qint64 shown = f.revision;
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(f.find("POST", "/pomodoro/next").first()).body).object(), revisionBody(shown));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(output.calls.size(), 1);
        const QDateTime rest = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(shortRest(rest, at), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QString());
        QCOMPARE(output.calls.size(), 2);
        QCOMPARE(output.calls.last(), QStringLiteral("stop"));

        f.advance(61);
        QVERIFY(f.serve());
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        const QDateTime second = f.clock.now();
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(42, second, std::nullopt), QJsonValue::Null, pomodoroJson(work(second, 1), 42))));
        QVERIFY(f.find("POST", "/app/timer/start").isEmpty());
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("UpcomingPhase")).toString(), QStringLiteral("longRest"));

        QVERIFY(f.restart());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);

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

    void sessionMessageIsPublished()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);

        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro", errorBody("Project not found"), 404));
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QStringLiteral("Project not found"));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("SessionMessage")).contains(QStringLiteral("Project not found"));
        }));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("CanStartSession")).toBool(), true);

        const QDateTime at = f.clock.now();
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QString());
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(work(at), 41))));
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
        QVERIFY(QTest::qWaitFor([&f] {
            const QVariantList published = f.recorder.valuesOf(QStringLiteral("Actions"));
            return !published.isEmpty()
                && qdbus_cast<QMap<QString, QVariantMap>>(published.last()).value(QStringLiteral("startSession")).value(QStringLiteral("visible")).toBool();
        }));
        const auto last = qdbus_cast<QMap<QString, QVariantMap>>(f.recorder.valuesOf(QStringLiteral("Actions")).last());
        QCOMPARE(last.value(QStringLiteral("startSession")).value(QStringLiteral("visible")).toBool(), true);
    }

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

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QVERIFY(QTest::qWaitFor([&f] {
            const QVariantList published = f.recorder.valuesOf(QStringLiteral("Presentation"));
            return !published.isEmpty()
                && qdbus_cast<QVariantMap>(published.last()).value(QStringLiteral("summary")).toStringList().contains(QStringLiteral("pomodoroMode"));
        }));
    }

    void activateInEachBranch()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
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
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(work(at), 41))));
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("open-menu"));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        f.advance(60);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(shortRest(f.clock.now(), at), 41))));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.find("POST", "/app/timer/start").size(), 1);
    }

    void pomodoroLengthLimitsAreTheCores()
    {
        Fixture f;
        QVERIFY(f.start());
        const auto published = [&f] {
            return qdbus_cast<QMap<QString, IntMap>>(f.get(QStringLiteral("PomodoroLengthLimits")).value<QDBusArgument>());
        };
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

        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {1, 1, 1, 2}).toBool(), false);
        QCOMPARE(f.find("POST", "/me/preferences").size(), 1);

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

        QCOMPARE(f.result(QStringLiteral("SetPomodoroLengths"), {2, 1, 1, 3}).toBool(), true);
        f.respond(f.find("POST", "/me/preferences").last(), FakeTransport::answer(400, errorBody("Preferences are too large")));
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))),
                 (StringMap{{QStringLiteral("general"), QStringLiteral("Preferences are too large")}}));

        const qsizetype reads = f.find("GET", "/me/preferences").size();
        QCOMPARE(f.timer(QStringLiteral("RefreshPreferences")).type(), QDBusMessage::ReplyMessage);
        const QList<qsizetype> found = f.find("GET", "/me/preferences");
        QCOMPARE(found.size(), reads + 1);
        f.respond(found.last(), FakeTransport::answer(200, preferencesBody({3, 1, 1, 3})));
        QCOMPARE(qdbus_cast<IntMap>(f.get(QStringLiteral("PomodoroLengths"))), lengthsMap({3, 1, 1, 3}));
        QVERIFY(qdbus_cast<StringMap>(f.get(QStringLiteral("PomodoroLengthErrors"))).isEmpty());
    }

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

        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        QCOMPARE(f.daemon->output.calls, QStringList{QStringLiteral("once ") + bundled(QStringLiteral("short-rest-to-work"))});

        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Sounds/workToShortRest")).toString(), QStringLiteral("long-rest-to-work"));
        }
        QVERIFY(f.restart());
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), chosen);
    }

    void alarmErrorTellsWhyNoSoundPlayed()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QString());
        FakeAlarmOutput &output = f.daemon->output;
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        output.fail(QStringLiteral("Connection refused"));
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QStringLiteral("No alarm sound: Connection refused"));
        QTRY_VERIFY(f.recorder.valuesOf(QStringLiteral("AlarmError")).contains(QStringLiteral("No alarm sound: Connection refused")));

        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("AlarmError")).toString(), QString());

        QTemporaryDir empty;
        QVERIFY(empty.isValid());
        PomodoroAlarm elsewhere(f.daemon->session, output, f.daemon->sounds, empty.path());
        QVERIFY(!elsewhere.preview(QStringLiteral("work-to-long-rest")));
        QCOMPARE(output.calls.size(), 2);
        QVERIFY2(elsewhere.failure().startsWith(QStringLiteral("No alarm sound: ")) && elsewhere.failure().contains(empty.path()), qPrintable(elsewhere.failure()));
    }

    void alarmPlayerDrivesTheBackend()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}).toBool(), true);
        FakeAlarmOutput &backend = f.daemon->output;
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        QCOMPARE(backend.calls, QStringList{QStringLiteral("once ") + bundled(QStringLiteral("short-rest-to-work"))});
        backend.calls.clear();

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        const QDateTime at = f.clock.now();
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(work(at), 41))));
        f.advance(59);
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QVERIFY(backend.calls.isEmpty());
        f.advance(1);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(backend.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("long-rest-to-work"))});
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("work-to-long-rest")}).toBool(), true);
        QCOMPARE(backend.calls.last(), QStringLiteral("loop ") + bundled(QStringLiteral("work-to-long-rest")));
        backend.calls.clear();
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("longRestToWork"), QStringLiteral("work-to-short-rest")}).toBool(), true);
        QVERIFY(backend.calls.isEmpty());
        FakeAlarmOutput late;
        PomodoroAlarm latePlayer(f.daemon->session, late, f.daemon->sounds, bundledSoundsDir());
        QCOMPARE(late.calls, QStringList{QStringLiteral("loop ") + bundled(QStringLiteral("work-to-long-rest"))});

        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        QVERIFY(f.answer("POST", "/pomodoro/next", f.change(chainEntry(41, at, std::nullopt), QJsonValue::Null, pomodoroJson(shortRest(f.clock.now(), at), 41))));
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
