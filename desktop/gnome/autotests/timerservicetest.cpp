// org.tokkl.Timer1 driven over a private D-Bus daemon, as the extension uses
// it, against the core's scripted transport, credential store and clock.

#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
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
#include <QTemporaryDir>
#include <QTest>
#include <QXmlStreamReader>

#include <memory>

using namespace Tokkl;

namespace
{
const QString instanceUrl = QStringLiteral("https://a.example.test");
const QString serviceBus = QStringLiteral("timerd-service");
const QString clientBus = QStringLiteral("timerd-client");
const QString propertiesInterface = QStringLiteral("org.freedesktop.DBus.Properties");
const QString startedAt = QStringLiteral("2026-10-16T08:58:55Z");

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
});
const QByteArray projectsBody = json(QJsonArray{
    projectObject(11, QStringLiteral("Alpha"), QStringLiteral("#06aaf5"), true),
    projectObject(12, QStringLiteral("Beta"), QStringLiteral("#d94182"), false),
});

// The newest entry the account has: stopped, on Alpha.
QByteArray recentBody()
{
    QJsonObject entry = entryObject(4, 11, false, true);
    entry.insert(QStringLiteral("project_active"), true);
    entry.insert(QStringLiteral("project_billable"), true);
    return json(QJsonArray{entry});
}

struct Interface {
    QMap<QString, QString> properties; // name -> "type access"
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
            return call(QStringLiteral("org.freedesktop.DBus.Peer"), QStringLiteral("Ping")).type() == QDBusMessage::ReplyMessage;
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
        const QMap<QString, QString> properties{
            {QStringLiteral("Running"), QStringLiteral("b read")},
            {QStringLiteral("StartTime"), QStringLiteral("x read")},
            {QStringLiteral("IndicatorState"), QStringLiteral("s read")},
            {QStringLiteral("IndicatorColor"), QStringLiteral("s read")},
            {QStringLiteral("Projects"), QStringLiteral("aa{sv} read")},
            {QStringLiteral("ChosenProject"), QStringLiteral("x read")},
            {QStringLiteral("Billable"), QStringLiteral("b read")},
            {QStringLiteral("Status"), QStringLiteral("s read")},
            {QStringLiteral("ErrorString"), QStringLiteral("s read")},
        };
        QCOMPARE(timer.properties, properties);
        const QMap<QString, QStringList> methods{
            {QStringLiteral("Start"), {QStringLiteral("out b")}},
            {QStringLiteral("Stop"), {QStringLiteral("out b")}},
            {QStringLiteral("SetProject"), {QStringLiteral("in x"), QStringLiteral("out b")}},
            {QStringLiteral("SetBillable"), {QStringLiteral("in b"), QStringLiteral("out b")}},
            {QStringLiteral("Configure"), {QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("in s"), QStringLiteral("in s")}},
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
        QCOMPARE(f.get(QStringLiteral("IndicatorState")).toString(), QStringLiteral("none"));
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

private:
    QTemporaryDir m_home;
    PrivateBus m_bus;
};

QTEST_GUILESS_MAIN(TimerServiceTest)
#include "timerservicetest.moc"
