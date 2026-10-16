#include "timerservice.h"

#include "timer1adaptor.h"

#include "connection.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "timercontroller.h"

#include <QDBusMessage>
#include <QDBusMetaType>
#include <QSettings>

#include <optional>

namespace Tokkl
{

const QString TimerService::serviceName = QStringLiteral("org.tokkl.Timer1");
const QString TimerService::objectPath = QStringLiteral("/org/tokkl/Timer1");
const QString TimerService::interfaceName = QStringLiteral("org.tokkl.Timer1");
const QString TimerService::credentialStoreError = QStringLiteral("org.tokkl.Timer1.Error.CredentialStore");

namespace
{
const QString instanceUrlKey = QStringLiteral("instanceUrl");
const QString authModeKey = QStringLiteral("authMode");
const QString emailKey = QStringLiteral("email");
}

QString TimerService::clientName()
{
    return QStringLiteral("tokkl-gnome");
}

TimerService::TimerService(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock, QObject *parent)
    : QObject(parent)
    , m_connection(new Connection(transport, store, clientName(), this))
    , m_timer(clock ? new TimerController(clock, this) : new TimerController(this))
    , m_store(store)
    , m_settingsFile(settingsFile)
    , m_bus(QString())
{
    qDBusRegisterMetaType<QList<QVariantMap>>();
    new Timer1Adaptor(this);

    m_timer->setConnection(m_connection);
    // Each property follows the core signal that announces its change.
    const auto publish = [this] {
        publishChanges();
    };
    connect(m_timer, &TimerController::currentEntryChanged, this, publish);
    connect(m_timer, &TimerController::indicatorChanged, this, publish);
    connect(m_timer, &TimerController::projectsChanged, this, publish);
    connect(m_timer, &TimerController::choiceChanged, this, publish);
    connect(m_timer, &TimerController::statusChanged, this, publish);

    loadSettings();
    m_published = snapshot();
}

TimerService::~TimerService()
{
    if (m_registered) {
        m_bus.unregisterService(serviceName);
        m_bus.unregisterObject(objectPath);
    }
}

bool TimerService::registerOn(QDBusConnection bus)
{
    if (!bus.registerObject(objectPath, this, QDBusConnection::ExportAdaptors)) {
        return false;
    }
    if (!bus.registerService(serviceName)) {
        bus.unregisterObject(objectPath);
        return false;
    }
    m_bus = bus;
    m_registered = true;
    m_published = snapshot();
    return true;
}

Connection *TimerService::connection() const
{
    return m_connection;
}

TimerController *TimerService::timer() const
{
    return m_timer;
}

bool TimerService::running() const
{
    return m_timer->isRunning();
}

qint64 TimerService::startTime() const
{
    const std::optional<TimeEntry> entry = m_timer->currentEntry();
    return entry && entry->isRunning() ? entry->start.toSecsSinceEpoch() : 0;
}

QString TimerService::indicatorState() const
{
    switch (m_timer->indicatorState()) {
    case TimerController::IndicatorState::None:
        break;
    case TimerController::IndicatorState::Pending:
        return QStringLiteral("pending");
    case TimerController::IndicatorState::Project:
        return QStringLiteral("project");
    }
    return QStringLiteral("none");
}

QString TimerService::indicatorColor() const
{
    return m_timer->indicatorColor();
}

QList<QVariantMap> TimerService::projects() const
{
    // Only the fields the interface names, so no null value reaches the bus.
    QList<QVariantMap> list;
    const QVariantList projects = m_timer->projects();
    for (const QVariant &value : projects) {
        const QVariantMap project = value.toMap();
        list.append({
            {QStringLiteral("id"), project.value(QStringLiteral("id")).toLongLong()},
            {QStringLiteral("name"), project.value(QStringLiteral("name")).toString()},
            {QStringLiteral("clientName"), project.value(QStringLiteral("clientName")).toString()},
            {QStringLiteral("color"), project.value(QStringLiteral("color")).toString()},
            {QStringLiteral("billable"), project.value(QStringLiteral("billable")).toBool()},
        });
    }
    return list;
}

qint64 TimerService::chosenProject() const
{
    const QVariant project = m_timer->chosenProjectId();
    return project.isNull() ? 0 : project.toLongLong();
}

bool TimerService::billable() const
{
    return m_timer->chosenBillable();
}

QString TimerService::status() const
{
    switch (m_timer->status()) {
    case TimerController::Unconfigured:
        return QStringLiteral("unconfigured");
    case TimerController::Loading:
        return QStringLiteral("loading");
    case TimerController::Ready:
        return QStringLiteral("ready");
    case TimerController::Busy:
        return QStringLiteral("busy");
    case TimerController::Stale:
        return QStringLiteral("stale");
    case TimerController::AuthenticationBlocked:
        return QStringLiteral("authentication-blocked");
    case TimerController::Error:
        break;
    }
    return QStringLiteral("error");
}

QString TimerService::errorString() const
{
    return m_timer->errorString();
}

bool TimerService::Start()
{
    return m_timer->start();
}

bool TimerService::Stop()
{
    return m_timer->stop();
}

bool TimerService::SetProject(qint64 projectId)
{
    return m_timer->chooseProject(projectId == 0 ? QVariant::fromValue(nullptr) : QVariant(projectId));
}

bool TimerService::SetBillable(bool billable)
{
    return m_timer->chooseBillable(billable);
}

void TimerService::Configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret)
{
    const InstanceUrl instance = parseInstanceUrl(instanceUrl);
    QString invalid;
    if (!instance.isValid()) {
        invalid = instance.error;
    } else if (authMode != QLatin1String("token") && authMode != QLatin1String("password")) {
        invalid = tr("The sign-in method must be \"token\" or \"password\".");
    } else if (authMode == QLatin1String("password") && email.trimmed().isEmpty()) {
        invalid = tr("Enter the email address of your Tokkl account.");
    }
    if (!invalid.isEmpty()) {
        if (calledFromDBus()) {
            sendErrorReply(QDBusError::InvalidArgs, invalid);
        }
        return;
    }

    const AuthMode mode = authModeFromString(authMode);
    // The same cleaning as the KDE Configure page: tokens never carry
    // surrounding whitespace, passwords are used exactly as typed.
    const QString cleaned = mode == AuthMode::Token ? secret.trimmed() : secret;
    const QString url = instance.base.toString();
    const QString address = email.trimmed();
    if (cleaned.isEmpty()) {
        applySettings(url, authMode, address);
        return;
    }

    std::optional<QDBusMessage> call;
    QDBusConnection bus(QString{});
    if (calledFromDBus()) {
        setDelayedReply(true);
        call = message();
        bus = QDBusContext::connection();
    }
    m_store->write(credentialKey(instance, mode, address), cleaned, this, [this, call, bus, url, authMode, address](const CredentialResult &result) {
        if (!result.ok()) {
            if (call) {
                bus.send(call->createErrorReply(credentialStoreError, m_store->message(result)));
            }
            return;
        }
        applySettings(url, authMode, address);
        if (call) {
            bus.send(call->createReply());
        }
    });
}

void TimerService::loadSettings()
{
    const QSettings settings(m_settingsFile, QSettings::IniFormat);
    const QString url = settings.value(instanceUrlKey).toString();
    if (!url.isEmpty()) {
        m_connection->setInstanceUrl(url);
        m_connection->setAuthModeString(settings.value(authModeKey).toString());
        m_connection->setEmail(settings.value(emailKey).toString());
    }
}

void TimerService::applySettings(const QString &instanceUrl, const QString &authMode, const QString &email)
{
    QSettings settings(m_settingsFile, QSettings::IniFormat);
    settings.setValue(instanceUrlKey, instanceUrl);
    settings.setValue(authModeKey, authMode);
    settings.setValue(emailKey, email);
    settings.sync();

    m_connection->setInstanceUrl(instanceUrl);
    m_connection->setAuthModeString(authMode);
    m_connection->setEmail(email);
}

QVariantMap TimerService::snapshot() const
{
    return {
        {QStringLiteral("Running"), running()},
        {QStringLiteral("StartTime"), startTime()},
        {QStringLiteral("IndicatorState"), indicatorState()},
        {QStringLiteral("IndicatorColor"), indicatorColor()},
        {QStringLiteral("Projects"), QVariant::fromValue(projects())},
        {QStringLiteral("ChosenProject"), chosenProject()},
        {QStringLiteral("Billable"), billable()},
        {QStringLiteral("Status"), status()},
        {QStringLiteral("ErrorString"), errorString()},
    };
}

// Sends PropertiesChanged with the properties whose value differs from what
// the bus last saw. A core signal that changed nothing visible sends nothing.
void TimerService::publishChanges()
{
    const QVariantMap current = snapshot();
    QVariantMap changed;
    for (auto it = current.cbegin(); it != current.cend(); ++it) {
        if (m_published.value(it.key()) != it.value()) {
            changed.insert(it.key(), it.value());
        }
    }
    m_published = current;
    if (!m_registered || changed.isEmpty()) {
        return;
    }
    QDBusMessage signal = QDBusMessage::createSignal(objectPath, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("PropertiesChanged"));
    signal << interfaceName << changed << QStringList();
    m_bus.send(signal);
}

}
