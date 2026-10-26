// org.tokkl.Timer1 driven over a private D-Bus daemon, as the extension uses
// it, against the core's scripted transport, credential store and clock.

#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "pomodorocycle.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "privatebus.h"
#include "timercontroller.h"
#include "timerservice.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusPendingCall>
#include <QDBusVariant>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMap>
#include <QSet>
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

// The answers of the instance to the reads the core sends.
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

// The newest entry the account has: stopped, on Alpha.
QByteArray recentBody()
{
    QJsonObject entry = entryObject(4, 11, false, true);
    entry.insert(QStringLiteral("project_active"), true);
    entry.insert(QStringLiteral("project_billable"), true);
    return json(QJsonArray{entry});
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

// Records PropertiesChanged of org.tokkl.Timer1 on the client connection.
class ChangeRecorder : public QObject
{
    Q_OBJECT

public:
    QList<QVariantMap> changes;

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
};
}

class TimerServiceTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        FakeTransport transport;
        FakeCredentialStore store;
        FakeClock clock;
        std::unique_ptr<TimerService> service;
        ChangeRecorder recorder;
        QSet<qsizetype> answered;
        // What GET /me/time_entries/current answers.
        QByteArray current = "null";

        QString settingsFile() const
        {
            return dir.filePath(QStringLiteral("tokkl/tokkl-timerd.conf"));
        }

        bool start()
        {
            service = std::make_unique<TimerService>(&transport, &store, settingsFile(), &clock);
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
            service.reset();
            service = std::make_unique<TimerService>(&transport, &store, settingsFile(), &clock);
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
                    } else if (path.endsWith("/me/time_entries/current")) {
                        body = current;
                    } else if (path.endsWith("/projects")) {
                        body = projectsBody;
                    } else if (path.endsWith("/me/time_entries")) {
                        body = recentBody();
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
            {QStringLiteral("Paused"), QStringLiteral("b read")},
            {QStringLiteral("ChainSeconds"), QStringLiteral("x read")},
            {QStringLiteral("IndicatorState"), QStringLiteral("s read")},
            {QStringLiteral("IndicatorColor"), QStringLiteral("s read")},
            {QStringLiteral("Projects"), QStringLiteral("aa{sv} read")},
            {QStringLiteral("ChosenProject"), QStringLiteral("x read")},
            {QStringLiteral("ChosenProjectName"), QStringLiteral("s read")},
            {QStringLiteral("Billable"), QStringLiteral("b read")},
            {QStringLiteral("Status"), QStringLiteral("s read")},
            {QStringLiteral("ErrorString"), QStringLiteral("s read")},
            {QStringLiteral("PomodoroMode"), QStringLiteral("b read")},
            {QStringLiteral("ModeLocked"), QStringLiteral("b read")},
            {QStringLiteral("SessionActive"), QStringLiteral("b read")},
            {QStringLiteral("Phase"), QStringLiteral("s read")},
            {QStringLiteral("PhaseStart"), QStringLiteral("x read")},
            {QStringLiteral("PlannedEnd"), QStringLiteral("x read")},
            {QStringLiteral("PomodoroNumber"), QStringLiteral("i read")},
            {QStringLiteral("LongRestEvery"), QStringLiteral("i read")},
            {QStringLiteral("NextPhase"), QStringLiteral("s read")},
            {QStringLiteral("Ringing"), QStringLiteral("b read")},
            {QStringLiteral("RingingTransition"), QStringLiteral("s read")},
            {QStringLiteral("SessionMessage"), QStringLiteral("s read")},
            {QStringLiteral("PomodoroLengths"), QStringLiteral("a{si} read")},
            {QStringLiteral("PomodoroLengthsEditable"), QStringLiteral("b read")},
            {QStringLiteral("PomodoroLengthErrors"), QStringLiteral("a{ss} read")},
            {QStringLiteral("Sounds"), QStringLiteral("a{ss} read")},
            {QStringLiteral("SoundChoices"), QStringLiteral("aa{sv} read")},
        };
        QCOMPARE(timer.properties, properties);
        const QMap<QString, QStringList> methods{
            {QStringLiteral("Start"), {QStringLiteral("out b")}},
            {QStringLiteral("Stop"), {QStringLiteral("out b")}},
            {QStringLiteral("Pause"), {QStringLiteral("out b")}},
            {QStringLiteral("Resume"), {QStringLiteral("out b")}},
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
            {QStringLiteral("SetSound"), {QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("out b")}},
            {QStringLiteral("PreviewSound"), {QStringLiteral("in s"), QStringLiteral("out b")}},
        };
        QCOMPARE(timer.methods, methods);
        QCOMPARE(described.properties, timer.properties);
        QCOMPARE(described.methods, timer.methods);
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
        TimerController *core = f.service->timer();
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

        // Start creates a new entry on the chosen project.
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        const QList<qsizetype> starts = f.find("POST", "/workspaces/7/time_entries");
        QCOMPARE(starts.size(), 1);
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(starts.first()).body).object();
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
        QCOMPARE(body.value(QStringLiteral("duration")).toInteger(), -1);
        // A second start while the first is in flight sends nothing.
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 1);

        f.current = json(entryObject(5, 12, true));
        f.respond(starts.first(), FakeTransport::answer(200, f.current));
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

        // Billable stays editable: one PUT that carries only billable.
        QCOMPARE(f.result(QStringLiteral("SetBillable"), {QVariant(true)}).toBool(), true);
        const QList<qsizetype> updates = f.find("PUT", "/workspaces/7/time_entries/5");
        QCOMPARE(updates.size(), 1);
        QCOMPARE(QJsonDocument::fromJson(f.transport.requests.at(updates.first()).body).object(), QJsonObject({{QStringLiteral("billable"), true}}));
        f.current = json(entryObject(5, 12, true, true));
        f.respond(updates.first(), FakeTransport::answer(200, f.current));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Billable")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Billable")).contains(true));

        // Stop, after which the next start defaults to the stopped entry's project.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        const QList<qsizetype> stops = f.find("PATCH", "/workspaces/7/time_entries/5/stop");
        QCOMPARE(stops.size(), 1);
        f.current = "null";
        f.respond(stops.first(), FakeTransport::answer(200, json(entryObject(5, 12, false, true))));
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

    // A running entry on an archived project: Projects lacks it, but the
    // core reads it, so the indicator shows it and ChosenProjectName names it.
    void archivedRunningProjectIsNamed()
    {
        Fixture f;
        f.current = json(entryObject(5, 99, true));
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
        const QList<QVariantMap> projects = qdbus_cast<QList<QVariantMap>>(f.get(QStringLiteral("Projects")));
        for (const QVariantMap &project : projects) {
            QVERIFY(project.value(QStringLiteral("id")).toLongLong() != 99);
        }
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("ChosenProjectName")).contains(QStringLiteral("Legacy"));
        }));
    }

    // Pause stops the running entry and keeps the chain, Resume starts its
    // clone, and ChainSeconds adds up the stopped entries until Stop ends
    // the chain. Running and StartTime keep their meaning throughout.
    void pauseAndResume()
    {
        Fixture f;
        const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
        f.current = json(chainEntry(5, begin, std::nullopt));
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
            // Pause sends one stop for the running entry.
            QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), true);
            const QList<qsizetype> stops = f.find("PATCH", QStringLiteral("/workspaces/7/time_entries/%1/stop").arg(running).toUtf8());
            QCOMPARE(stops.size(), 1);
            f.current = "null";
            f.respond(stops.first(), FakeTransport::answer(200, json(chainEntry(running, begin, seconds))));
            QVERIFY(f.serve());
            total += seconds;
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

            // Resume starts a clone of the paused entry.
            const qsizetype before = f.find("POST", "/workspaces/7/time_entries").size();
            QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), true);
            const QList<qsizetype> starts = f.find("POST", "/workspaces/7/time_entries");
            QCOMPARE(starts.size(), before + 1);
            const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(starts.last()).body).object();
            QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 12);
            QCOMPARE(body.value(QStringLiteral("billable")).toBool(), true);
            QCOMPARE(body.value(QStringLiteral("description")).toString(), QStringLiteral("Review"));
            QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
            ++running;
            const QDateTime resumed = f.clock.now();
            f.current = json(chainEntry(running, resumed, std::nullopt));
            f.respond(starts.last(), FakeTransport::answer(200, f.current));
            QVERIFY(f.serve());
            QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
            QCOMPARE(f.get(QStringLiteral("StartTime")).toLongLong(), resumed.toSecsSinceEpoch());
            QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
            QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), total);
        }

        // Stop while running ends the chain.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        const QList<qsizetype> stops = f.find("PATCH", QStringLiteral("/workspaces/7/time_entries/%1/stop").arg(running).toUtf8());
        QCOMPARE(stops.size(), 1);
        f.current = "null";
        f.respond(stops.first(), FakeTransport::answer(200, json(chainEntry(running, f.clock.now(), 300))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 0);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ChainSeconds")).contains(qint64(0)));
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);
    }

    // Stop while paused sends nothing and only clears the chain, so the next
    // Start begins a new one.
    void stopWhilePausedClearsTheChain()
    {
        Fixture f;
        const QDateTime begin = QDateTime::fromString(startedAt, Qt::ISODate);
        f.current = json(chainEntry(5, begin, std::nullopt));
        QVERIFY(f.start());
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("Pause")).toBool(), true);
        const QList<qsizetype> stops = f.find("PATCH", "/workspaces/7/time_entries/5/stop");
        QCOMPARE(stops.size(), 1);
        f.current = "null";
        f.respond(stops.first(), FakeTransport::answer(200, json(chainEntry(5, begin, 600))));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 600);

        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ChainSeconds")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Paused")).contains(false));
        // Nothing is left to stop or resume, and the next start is plain.
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Resume")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), true);
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 1);
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
        QCOMPARE(f.service->connection()->instanceUrl(), QString());
    }

    // A refused secret leaves the settings as they were.
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
        QCOMPARE(f.service->connection()->instanceUrl(), QString());
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
        QCOMPARE(f.service->connection()->instanceUrl(), instanceUrl);
        QVERIFY(f.serve());
        QCOMPARE(f.transport.requests.at(f.find("GET", "/me").first()).authorization,
                 basicAuthorization(AuthMode::Token, QString(), QStringLiteral("tok-saved")));

        const QDBusMessage reply = f.timer(QStringLiteral("Configure"), {instanceUrl, QStringLiteral("token"), QString(), QString()});
        QCOMPARE(reply.type(), QDBusMessage::ReplyMessage);
        QCOMPARE(f.store.writes, 0);
    }

    // A second instance cannot take the name, as tokkl-timerd then exits.
    void secondInstanceRefused()
    {
        Fixture f;
        QVERIFY(f.start());
        FakeTransport transport;
        FakeCredentialStore store;
        TimerService second(&transport, &store, f.dir.filePath(QStringLiteral("second.conf")));
        QVERIFY(!second.registerOn(QDBusConnection(clientBus)));
        QCOMPARE(QDBusConnection(clientBus).interface()->serviceOwner(TimerService::serviceName).value(), QDBusConnection(serviceBus).baseService());
    }

    // Pomodoro mode is stored and locks while a session runs. The session's
    // state is published, the planned end rings, with the chosen sound for
    // the player, and Next phase saves the ended pomodoro through the
    // transport with the service's client name. A restart continues the
    // session.
    void pomodoroSessionOverTheBus()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("PhaseStart")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), 0);
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 0);
        QCOMPARE(f.get(QStringLiteral("NextPhase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("SessionMessage")).toString(), QString());
        QCOMPARE(f.result(QStringLiteral("SetSound"), {QStringLiteral("workToShortRest"), QStringLiteral("long-rest-to-work")}).toBool(), true);
        QSignalSpy alarms(f.service.get(), &TimerService::alarmChanged);

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroMode")).contains(true));
        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Pomodoro/pomodoroMode")).toBool(), true);
        }
        // Start is refused in Pomodoro mode and sends nothing.
        const qsizetype sent = f.transport.requests.size();
        QCOMPARE(f.result(QStringLiteral("Start")).toBool(), false);
        QCOMPARE(f.transport.requests.size(), sent);

        // Start session reads the lengths once more and starts at the click
        // instant once the read ends.
        const QDateTime at = f.clock.now();
        QCOMPARE(f.find("GET", "/me/preferences").size(), 1);
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QCOMPARE(f.find("GET", "/me/preferences").size(), 2);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PhaseStart")).toLongLong(), at.toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), at.addSecs(60).toSecsSinceEpoch());
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 1);
        QCOMPARE(f.get(QStringLiteral("LongRestEvery")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("NextPhase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("SessionActive")).contains(true);
        }));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Phase")).contains(QStringLiteral("work")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PhaseStart")).contains(at.toSecsSinceEpoch()));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PlannedEnd")).contains(at.addSecs(60).toSecsSinceEpoch()));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("PomodoroNumber")).contains(1));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("NextPhase")).contains(QStringLiteral("shortRest")));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ModeLocked")).contains(true));
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);

        // The countdown is not published; the planned end is, as Ringing,
        // and the player hears the sound chosen for the transition.
        f.advance(59);
        QVERIFY(f.serve());
        QVERIFY(f.ping());
        QVERIFY(f.recorder.valuesOf(QStringLiteral("Ringing")).isEmpty());
        QCOMPARE(alarms.size(), 0);
        f.advance(1);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QStringLiteral("workToShortRest"));
        QVERIFY(QTest::qWaitFor([&f] {
            return f.recorder.valuesOf(QStringLiteral("Ringing")).contains(true);
        }));
        QVERIFY(f.recorder.valuesOf(QStringLiteral("RingingTransition")).contains(QStringLiteral("workToShortRest")));
        QCOMPARE(alarms.size(), 1);
        QCOMPARE(alarms.last(), (QVariantList{true, QStringLiteral("long-rest-to-work")}));

        // Work to rest saves nothing and silences the alarm.
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("NextPhase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("RingingTransition")).toString(), QString());
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 0);
        QCOMPARE(alarms.size(), 2);
        QCOMPARE(alarms.last(), (QVariantList{false, QString()}));

        // Rest to work saves the pomodoro from its work start to now,
        // snapped to the account's minute grid.
        f.advance(61);
        QVERIFY(f.serve());
        QCOMPARE(f.result(QStringLiteral("NextPhase")).toBool(), true);
        const QList<qsizetype> posts = f.find("POST", "/workspaces/7/time_entries");
        QCOMPARE(posts.size(), 1);
        const QJsonObject body = QJsonDocument::fromJson(f.transport.requests.at(posts.first()).body).object();
        QCOMPARE(body.value(QStringLiteral("start")).toString(), at.toString(Qt::ISODate));
        QCOMPARE(body.value(QStringLiteral("stop")).toString(), at.addSecs(120).toString(Qt::ISODate));
        QCOMPARE(body.value(QStringLiteral("duration")).toInteger(), 120);
        QCOMPARE(body.value(QStringLiteral("created_with")).toString(), QStringLiteral("tokkl-gnome"));
        QCOMPARE(body.value(QStringLiteral("project_id")).toInteger(), 11);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("NextPhase")).toString(), QStringLiteral("longRest"));
        QJsonObject saved = body;
        saved.insert(QStringLiteral("id"), 100);
        f.respond(posts.first(), FakeTransport::answer(200, json(saved)));

        // A restarted service continues the stored session once it has
        // connected with the saved settings.
        QVERIFY(f.restart());
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        QCOMPARE(f.get(QStringLiteral("PomodoroNumber")).toInt(), 2);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);

        // End session saves the open pomodoro and unlocks the mode.
        f.advance(90);
        QVERIFY(f.serve());
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QString());
        QCOMPARE(f.get(QStringLiteral("PlannedEnd")).toLongLong(), 0);
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 2);
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
    }

    // A pomodoro too short to save is reported as SessionMessage.
    void sessionMessageIsPublished()
    {
        Fixture f;
        QVERIFY(f.start());
        QVERIFY(f.connect());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), true);
        QVERIFY(f.serve());
        f.advance(10);
        QCOMPARE(f.result(QStringLiteral("EndSession")).toBool(), true);
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 0);
        const QString message = f.get(QStringLiteral("SessionMessage")).toString();
        QVERIFY(!message.isEmpty());
        QVERIFY(QTest::qWaitFor([&f, &message] {
            return f.recorder.valuesOf(QStringLiteral("SessionMessage")).contains(message);
        }));
    }

    // Activate: in Timer mode, and while an entry runs or a chain is
    // paused, it toggles the timer (start, pause, resume); in Pomodoro mode
    // it starts a session, is ignored while the read runs or without an
    // account, opens the menu during a phase, and confirms the next phase
    // while ringing.
    void activateInEachBranch()
    {
        Fixture f;
        QVERIFY(f.start());
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QCOMPARE(f.result(QStringLiteral("StartSession")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(false)}).toBool(), true);
        QVERIFY(f.connect());

        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        const QList<qsizetype> starts = f.find("POST", "/workspaces/7/time_entries");
        QCOMPARE(starts.size(), 1);
        f.current = json(entryObject(5, 11, true));
        f.respond(starts.first(), FakeTransport::answer(200, f.current));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("PomodoroMode")).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        const QList<qsizetype> stops = f.find("PATCH", "/workspaces/7/time_entries/5/stop");
        QCOMPARE(stops.size(), 1);
        f.current = "null";
        f.respond(stops.first(), FakeTransport::answer(200, json(entryObject(5, 11, false))));
        QVERIFY(f.serve());
        // The click paused the chain, which locks the mode too; Stop while
        // paused clears it.
        QCOMPARE(f.get(QStringLiteral("Running")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), false);
        QCOMPARE(f.result(QStringLiteral("Stop")).toBool(), true);
        QCOMPARE(f.get(QStringLiteral("Paused")).toBool(), false);
        QCOMPARE(f.get(QStringLiteral("ModeLocked")).toBool(), false);
        QVERIFY(f.recorder.valuesOf(QStringLiteral("ModeLocked")).contains(true));

        QCOMPARE(f.result(QStringLiteral("SetPomodoroMode"), {QVariant(true)}).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("ignored"));
        QVERIFY(f.serve());
        QCOMPARE(f.get(QStringLiteral("SessionActive")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("open-menu"));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("work"));
        f.advance(60);
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), true);
        QCOMPARE(f.result(QStringLiteral("Activate")).toString(), QStringLiteral("handled"));
        QCOMPARE(f.get(QStringLiteral("Phase")).toString(), QStringLiteral("shortRest"));
        QCOMPARE(f.get(QStringLiteral("Ringing")).toBool(), false);
        QCOMPARE(f.find("POST", "/workspaces/7/time_entries").size(), 1);
    }

    // The lengths follow the account; a save sends only what differs, and
    // the server's refusals show per length or as the general error.
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
        f.respond(saves.first(), FakeTransport::answer(400, errorBody("Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180")));
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
        QSignalSpy previews(f.service.get(), &TimerService::previewRequested);
        QCOMPARE(f.result(QStringLiteral("PreviewSound"), {QStringLiteral("short-rest-to-work")}).toBool(), true);
        QCOMPARE(previews.size(), 1);
        QCOMPARE(previews.first(), (QVariantList{QStringLiteral("short-rest-to-work")}));

        {
            const QSettings settings(f.settingsFile(), QSettings::IniFormat);
            QCOMPARE(settings.value(QStringLiteral("Sounds/workToShortRest")).toString(), QStringLiteral("long-rest-to-work"));
        }
        QVERIFY(f.restart());
        QCOMPARE(qdbus_cast<StringMap>(f.get(QStringLiteral("Sounds"))), chosen);
    }

private:
    QTemporaryDir m_home;
    PrivateBus m_bus;
};

QTEST_GUILESS_MAIN(TimerServiceTest)
#include "timerservicetest.moc"
