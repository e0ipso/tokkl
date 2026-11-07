#pragma once

// The timer and the Pomodoro session of the shared core on D-Bus, as
// org.tokkl.Timer1 (described in dbus/org.tokkl.Timer1.xml). The service
// maps the core's properties onto the interface and forwards the methods;
// the rules stay in the core. The one thing it adds is where the core's
// per-device state lives: the connection settings, the mode and the sound
// choices go to its settings file. The timer and the session are the
// server's, read through one TimerStateClient. The alarm plays through a
// PomodoroAlarm that main.cpp builds on session() and soundChoices().

#include <QDBusConnection>
#include <QDBusContext>
#include <QList>
#include <QMap>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QVariantMap>

#include "apitypes.h"

class QSettings;
class TimerServiceTest;

namespace Tokkl
{
class Clock;
class Connection;
class CredentialStore;
class PomodoroAlarm;
class PomodoroPreferences;
class PomodoroSession;
class ServiceSettings;
class SettingsPomodoroStore;
class SoundChoices;
class TimerController;
class TimerStateClient;
class Transport;

class TimerService : public QObject, protected QDBusContext
{
    Q_OBJECT

    // The org.tokkl.Timer1 properties, read by the generated adaptor. They
    // have no NOTIFY: publishChanges() sends their changes to the bus as
    // PropertiesChanged.
    Q_PROPERTY(bool Running READ running)
    Q_PROPERTY(qint64 StartTime READ startTime)
    Q_PROPERTY(bool Paused READ paused)
    Q_PROPERTY(qint64 ChainSeconds READ chainSeconds)
    Q_PROPERTY(QString IndicatorState READ indicatorState)
    Q_PROPERTY(QString IndicatorColor READ indicatorColor)
    Q_PROPERTY(QList<QVariantMap> Projects READ projects)
    Q_PROPERTY(qint64 ChosenProject READ chosenProject)
    Q_PROPERTY(QString ChosenProjectName READ chosenProjectName)
    Q_PROPERTY(bool Billable READ billable)
    Q_PROPERTY(QString Status READ status)
    Q_PROPERTY(QString ErrorString READ errorString)
    Q_PROPERTY(bool PomodoroMode READ pomodoroMode)
    Q_PROPERTY(bool ModeLocked READ modeLocked)
    Q_PROPERTY(bool SessionActive READ sessionActive)
    Q_PROPERTY(bool CanStartSession READ canStartSession)
    Q_PROPERTY(QString Phase READ phase)
    Q_PROPERTY(qint64 PhaseStart READ phaseStart)
    Q_PROPERTY(qint64 PlannedEnd READ plannedEnd)
    Q_PROPERTY(int PomodoroNumber READ pomodoroNumber)
    Q_PROPERTY(int LongRestEvery READ longRestEvery)
    Q_PROPERTY(QString UpcomingPhase READ upcomingPhase)
    Q_PROPERTY(bool Ringing READ ringing)
    Q_PROPERTY(QString RingingTransition READ ringingTransition)
    Q_PROPERTY(QString SessionMessage READ sessionMessage)
    Q_PROPERTY(QMap<QString, int> PomodoroLengths READ pomodoroLengths)
    Q_PROPERTY(bool PomodoroLengthsEditable READ pomodoroLengthsEditable)
    Q_PROPERTY(QMap<QString, QString> PomodoroLengthErrors READ pomodoroLengthErrors)
    Q_PROPERTY(QMap<QString, QString> Sounds READ sounds)
    Q_PROPERTY(QList<QVariantMap> SoundChoices READ soundCatalogue)

public:
    static const QString serviceName;
    static const QString objectPath;
    static const QString interfaceName;
    // The error of a Configure call whose secret the credential store refused.
    static const QString credentialStoreError;
    // The settings key of a transition's sound: "Sounds/workToShortRest" and
    // so on.
    static QString soundKey(TransitionKind kind);

    // The client name the service gives the core: the created_with value of
    // the entries it starts. The caller's transport should send it as its
    // User-Agent product too.
    static QString clientName();

    // Runs the core on the given transport and credential store, which the
    // service does not own. Settings (address, sign-in method and email;
    // never the secret), the Pomodoro mode and the sound choices are read
    // from and saved to settingsFile. A null clock means the system clock.
    TimerService(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock = nullptr, QObject *parent = nullptr);
    ~TimerService() override;

    // Exports the interface on the bus and takes the service name. False when
    // the bus refuses either, for example because another instance owns the
    // name.
    bool registerOn(QDBusConnection bus);

    PomodoroSession *session() const;
    SoundChoices *soundChoices() const;
    // The alarm PreviewSound plays on, which the service does not own.
    // Without one, PreviewSound is refused.
    void setAlarm(PomodoroAlarm *alarm);

    bool running() const;
    qint64 startTime() const;
    bool paused() const;
    qint64 chainSeconds() const;
    QString indicatorState() const;
    QString indicatorColor() const;
    QList<QVariantMap> projects() const;
    qint64 chosenProject() const;
    QString chosenProjectName() const;
    bool billable() const;
    QString status() const;
    QString errorString() const;
    bool pomodoroMode() const;
    bool modeLocked() const;
    bool sessionActive() const;
    bool canStartSession() const;
    QString phase() const;
    qint64 phaseStart() const;
    qint64 plannedEnd() const;
    int pomodoroNumber() const;
    int longRestEvery() const;
    QString upcomingPhase() const;
    bool ringing() const;
    QString ringingTransition() const;
    QString sessionMessage() const;
    QMap<QString, int> pomodoroLengths() const;
    bool pomodoroLengthsEditable() const;
    QMap<QString, QString> pomodoroLengthErrors() const;
    QMap<QString, QString> sounds() const;
    QList<QVariantMap> soundCatalogue() const;

public Q_SLOTS:
    // The org.tokkl.Timer1 methods, called by the generated adaptor.
    bool Start();
    bool Stop();
    bool Pause();
    bool Resume();
    bool SetProject(qint64 projectId);
    bool SetBillable(bool billable);
    void Configure(const QString &instanceUrl, const QString &authMode, const QString &email, const QString &secret);
    bool SetPomodoroMode(bool pomodoro);
    QString Activate();
    bool StartSession();
    bool NextPhase();
    bool EndSession();
    bool SetPomodoroLengths(int work, int shortRest, int longRest, int longRestEvery);
    void RefreshPreferences();
    bool SetSound(const QString &transition, const QString &soundId);
    bool PreviewSound(const QString &soundId);

private:
    // The tests check what reaches the core.
    friend class ::TimerServiceTest;

    QVariantMap snapshot() const;
    void publishChanges();

    QSettings *m_settings;
    Clock *m_clock;
    Connection *m_connection;
    TimerController *m_timer;
    TimerStateClient *m_client;
    SettingsPomodoroStore *m_pomodoroStore;
    SoundChoices *m_sounds;
    PomodoroPreferences *m_preferences;
    PomodoroSession *m_session;
    ServiceSettings *m_connectionSettings;
    QPointer<PomodoroAlarm> m_alarm;
    QDBusConnection m_bus;
    bool m_registered = false;
    // The property values the bus last saw.
    QVariantMap m_published;
};
}
