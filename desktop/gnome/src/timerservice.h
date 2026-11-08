#pragma once

// The timer and the Pomodoro session of the shared core on D-Bus, as
// org.tokkl.Timer1 (described in dbus/org.tokkl.Timer1.xml). The service
// maps the core's properties onto the interface and forwards the methods;
// the rules stay in the core. It builds none of the objects it serves:
// main.cpp, the daemon's composition root, makes the connection, the timer
// and its state client, the session, the preferences client, the sound
// choices and the settings file they keep the per-device state in, and the
// ConfigurationAdapter that answers Configure, then hands them over. The
// alarm plays through a PomodoroAlarm that main.cpp builds on the same
// session and sound choices.

#include <QDBusConnection>
#include <QDBusContext>
#include <QList>
#include <QMap>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QVariantMap>

#include "apitypes.h"

namespace Tokkl
{
class ConfigurationAdapter;
class PomodoroAlarm;
class PomodoroPreferences;
class PomodoroSession;
class SoundChoices;
class TimerCoordinator;
class TimerModel;

class TimerService : public QObject, protected QDBusContext
{
    Q_OBJECT

    // The org.tokkl.Timer1 properties, read by the generated adaptor. They
    // have no NOTIFY: the service sends their changes to the bus as
    // PropertiesChanged, once per turn of the event loop.
    Q_PROPERTY(bool Running READ running)
    Q_PROPERTY(qint64 StartTime READ startTime)
    Q_PROPERTY(qint64 LocalStartTime READ localStartTime)
    Q_PROPERTY(bool Paused READ paused)
    Q_PROPERTY(qint64 ChainSeconds READ chainSeconds)
    Q_PROPERTY(QString IndicatorState READ indicatorState)
    Q_PROPERTY(QString IndicatorColor READ indicatorColor)
    Q_PROPERTY(QList<QVariantMap> Projects READ projects)
    Q_PROPERTY(bool ProjectsIncomplete READ projectsIncomplete)
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
    Q_PROPERTY(QMap<QString, QVariantMap> Actions READ actions)
    Q_PROPERTY(QMap<QString, int> PomodoroLengths READ pomodoroLengths)
    Q_PROPERTY(bool PomodoroLengthsEditable READ pomodoroLengthsEditable)
    Q_PROPERTY(QMap<QString, QString> PomodoroLengthErrors READ pomodoroLengthErrors)
    Q_PROPERTY(QMap<QString, QString> Sounds READ sounds)
    Q_PROPERTY(QList<QVariantMap> SoundChoices READ soundCatalogue)

public:
    static const QString serviceName;
    static const QString objectPath;
    static const QString interfaceName;
    // The settings key of a transition's sound: "Sounds/workToShortRest" and
    // so on.
    static QString soundKey(TransitionKind kind);

    // The client name the service gives the core: the created_with value of
    // the entries it starts. The caller's transport should send it as its
    // User-Agent product too.
    static QString clientName();

    // What the service serves, none of it owned. The session must be built
    // on the timer's coordinator, and the alarm on the same session and
    // sound choices.
    struct Parts {
        TimerModel *timer = nullptr;
        TimerCoordinator *actions = nullptr;
        PomodoroSession *session = nullptr;
        PomodoroPreferences *preferences = nullptr;
        SoundChoices *sounds = nullptr;
        ConfigurationAdapter *configuration = nullptr;
    };

    explicit TimerService(const Parts &parts, QObject *parent = nullptr);
    ~TimerService() override;

    // Exports the interface on the bus and takes the service name. False when
    // the bus refuses either, for example because another instance owns the
    // name.
    bool registerOn(QDBusConnection bus);

    // The alarm PreviewSound plays on, which the service does not own.
    // Without one, PreviewSound is refused.
    void setAlarm(PomodoroAlarm *alarm);

    bool running() const;
    // The server's start, which StartTime has always published.
    qint64 startTime() const;
    // The start on this machine's clock, corrected by the state client's
    // server offset, so elapsed time matches the other apps.
    qint64 localStartTime() const;
    bool paused() const;
    qint64 chainSeconds() const;
    QString indicatorState() const;
    QString indicatorColor() const;
    QList<QVariantMap> projects() const;
    bool projectsIncomplete() const;
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
    // MenuActionStates with the GNOME policy, as the menu reads them.
    QMap<QString, QVariantMap> actions() const;
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
    // The properties in groups that change together. Each core signal marks
    // the groups it can change, and only those are read again.
    enum Group : unsigned {
        TimerGroup = 1u << 0, // the entry, chain, choice, indicator and status
        ProjectsGroup = 1u << 1,
        SessionGroup = 1u << 2,
        ActionsGroup = 1u << 3, // reads both the timer and the session
        LengthsGroup = 1u << 4,
        SoundsGroup = 1u << 5,
        FixedGroup = 1u << 6, // never changes while the service runs
        AllGroups = (1u << 7) - 1,
    };

    QVariantMap timerProperties() const;
    QVariantMap projectProperties() const;
    QVariantMap sessionProperties() const;
    QVariantMap actionProperties() const;
    QVariantMap lengthProperties() const;
    QVariantMap soundProperties() const;
    QVariantMap fixedProperties() const;
    // The values of the given groups, as the adaptor reads them.
    QVariantMap read(unsigned groups) const;
    // Marks the groups and publishes them when the event loop next runs.
    void mark(unsigned groups);
    // Sends PropertiesChanged now for what changed in the marked groups.
    void publishChanges();
    // A method's answer, sent after what the method changed: D-Bus clients
    // read their cached properties when the answer arrives.
    template<typename T>
    T answer(T value)
    {
        publishChanges();
        return value;
    }

    TimerModel *m_timer;
    TimerCoordinator *m_actions;
    PomodoroSession *m_session;
    PomodoroPreferences *m_preferences;
    SoundChoices *m_sounds;
    ConfigurationAdapter *m_configuration;
    QPointer<PomodoroAlarm> m_alarm;
    QDBusConnection m_bus;
    bool m_registered = false;
    // The property values the bus last saw.
    QVariantMap m_published;
    // The groups marked since the last publish.
    unsigned m_dirty = 0;
    bool m_publishQueued = false;
};
}
