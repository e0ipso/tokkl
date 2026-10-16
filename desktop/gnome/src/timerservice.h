#pragma once

// The timer of the shared core on D-Bus, as org.tokkl.Timer1 (described in
// dbus/org.tokkl.Timer1.xml). The service maps the core's properties onto the
// interface and forwards the methods; the rules stay in the core.

#include <QDBusConnection>
#include <QDBusContext>
#include <QList>
#include <QObject>
#include <QString>
#include <QVariantMap>

namespace Tokkl
{
class Clock;
class Connection;
class CredentialStore;
class TimerController;
class Transport;

class TimerService : public QObject, protected QDBusContext
{
    Q_OBJECT

    // The org.tokkl.Timer1 properties, read by the generated adaptor.
    Q_PROPERTY(bool Running READ running)
    Q_PROPERTY(qint64 StartTime READ startTime)
    Q_PROPERTY(QString IndicatorState READ indicatorState)
    Q_PROPERTY(QString IndicatorColor READ indicatorColor)
    Q_PROPERTY(QList<QVariantMap> Projects READ projects)
    Q_PROPERTY(qint64 ChosenProject READ chosenProject)
    Q_PROPERTY(bool Billable READ billable)
    Q_PROPERTY(QString Status READ status)
    Q_PROPERTY(QString ErrorString READ errorString)

public:
    static const QString serviceName;
    static const QString objectPath;
    static const QString interfaceName;
    // The error of a Configure call whose secret the credential store refused.
    static const QString credentialStoreError;

    // The client name the service gives the core: the created_with value of
    // the entries it starts. The caller's transport should send it as its
    // User-Agent product too.
    static QString clientName();

    // Runs the core on the given transport and credential store, which the
    // service does not own. Settings (address, sign-in method and email; never
    // the secret) are read from and saved to settingsFile. A null clock means
    // the system clock.
    TimerService(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock = nullptr, QObject *parent = nullptr);
    ~TimerService() override;

    // Exports the interface on the bus and takes the service name. False when
    // the bus refuses either, for example because another instance owns the
    // name.
    bool registerOn(QDBusConnection bus);

    Connection *connection() const;
    TimerController *timer() const;

    bool running() const;
    qint64 startTime() const;
    QString indicatorState() const;
    QString indicatorColor() const;
    QList<QVariantMap> projects() const;
    qint64 chosenProject() const;
    bool billable() const;
    QString status() const;
    QString errorString() const;

public Q_SLOTS:
    // The org.tokkl.Timer1 methods, called by the generated adaptor.
    bool Start();
    bool Stop();
    bool SetProject(qint64 projectId);
    bool SetBillable(bool billable);
    void Configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret);

private:
    void loadSettings();
    void applySettings(const QString &instanceUrl, const QString &authMode, const QString &email);
    QVariantMap snapshot() const;
    void publishChanges();

    Connection *m_connection;
    TimerController *m_timer;
    CredentialStore *m_store;
    QString m_settingsFile;
    QDBusConnection m_bus;
    bool m_registered = false;
    // The property values the bus last saw.
    QVariantMap m_published;
};
}
