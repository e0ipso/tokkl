#pragma once

// The timer and the Pomodoro session of the shared core on D-Bus, as
// org.tokkl.Timer1 (described in dbus/org.tokkl.Timer1.xml). The service
// maps the core's properties onto the interface and forwards the methods;
// the rules stay in the core. The one thing it adds is where the core's
// per-device state lives: the mode, the session records and the sound
// choices go to its settings file.

#include <QDBusConnection>
#include <QDBusContext>
#include <QList>
#include <QMap>
#include <QObject>
#include <QString>
#include <QVariantMap>

class QSettings;

namespace Tokkl
{
class Clock;
class Connection;
class CredentialStore;
class PomodoroPreferences;
class PomodoroQueue;
class PomodoroSession;
class SettingsPomodoroStore;
class TimerController;
class Transport;

class TimerService : public QObject, protected QDBusContext
{
    Q_OBJECT

    // The org.tokkl.Timer1 properties, read by the generated adaptor.
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
    Q_PROPERTY(QString Phase READ phase)
    Q_PROPERTY(qint64 PhaseStart READ phaseStart)
    Q_PROPERTY(qint64 PlannedEnd READ plannedEnd)
    Q_PROPERTY(int PomodoroNumber READ pomodoroNumber)
    Q_PROPERTY(int LongRestEvery READ longRestEvery)
    Q_PROPERTY(QString NextPhase READ nextPhase)
    Q_PROPERTY(bool Ringing READ ringing)
    Q_PROPERTY(QString RingingTransition READ ringingTransition)
    Q_PROPERTY(QString SessionMessage READ sessionMessage)
    Q_PROPERTY(QMap<QString, int> PomodoroLengths READ pomodoroLengths)
    Q_PROPERTY(bool PomodoroLengthsEditable READ pomodoroLengthsEditable)
    Q_PROPERTY(QMap<QString, QString> PomodoroLengthErrors READ pomodoroLengthErrors)
    Q_PROPERTY(QMap<QString, QString> Sounds READ sounds)
    Q_PROPERTY(QList<QVariantMap> SoundChoices READ soundChoices)

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
    // service does not own. Settings (address, sign-in method and email;
    // never the secret), the Pomodoro mode, the session records and the
    // sound choices are read from and saved to settingsFile. A null clock
    // means the system clock, with the pause chain kept in the
    // application's default settings as the core does by default.
    TimerService(Transport *transport, CredentialStore *store, const QString &settingsFile, Clock *clock = nullptr, QObject *parent = nullptr);
    ~TimerService() override;

    // Exports the interface on the bus and takes the service name. False when
    // the bus refuses either, for example because another instance owns the
    // name.
    bool registerOn(QDBusConnection bus);

    Connection *connection() const;
    TimerController *timer() const;
    PomodoroSession *session() const;

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
    QString phase() const;
    qint64 phaseStart() const;
    qint64 plannedEnd() const;
    int pomodoroNumber() const;
    int longRestEvery() const;
    QString nextPhase() const;
    bool ringing() const;
    QString ringingTransition() const;
    QString sessionMessage() const;
    QMap<QString, int> pomodoroLengths() const;
    bool pomodoroLengthsEditable() const;
    QMap<QString, QString> pomodoroLengthErrors() const;
    QMap<QString, QString> sounds() const;
    QList<QVariantMap> soundChoices() const;

    // The id of the sound chosen for a transition (a RingingTransition
    // name), or empty for a transition the core does not have.
    QString soundFor(const QString &transition) const;

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

Q_SIGNALS:
    // For the sound player. The alarm starts ringing with the sound chosen
    // for the transition, or stops (ringing false, soundId empty). Also
    // emitted when the sound chosen for the ringing transition changes.
    void alarmChanged(bool ringing, const QString &soundId);
    // PreviewSound asked for a sound to be played once.
    void previewRequested(const QString &soundId);

private:
    void loadSettings();
    void applySettings(const QString &instanceUrl, const QString &authMode, const QString &email);
    QVariantMap snapshot() const;
    void publishChanges();
    void updateAlarm();

    QSettings *m_settings;
    Clock *m_clock;
    Connection *m_connection;
    TimerController *m_timer;
    SettingsPomodoroStore *m_pomodoroStore;
    PomodoroPreferences *m_preferences;
    PomodoroQueue *m_queue;
    PomodoroSession *m_session;
    CredentialStore *m_store;
    QDBusConnection m_bus;
    bool m_registered = false;
    // The property values the bus last saw.
    QVariantMap m_published;
    // The alarm as the player last heard it: empty while silent.
    QString m_alarmSound;
};
}
