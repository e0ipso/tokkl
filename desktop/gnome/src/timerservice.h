#pragma once

// The timer and the Pomodoro session of the shared core on D-Bus, as
// org.tokkl.Timer1 (described in dbus/org.tokkl.Timer1.xml). The service
// maps the core's properties onto the interface and forwards the methods;
// the rules stay in the core. It builds none of the objects it serves:
// main.cpp, the daemon's composition root, makes the connection, the timer
// and its state client, the session, the preferences client, the sound
// choices and the settings file they keep the per-device state in, and the
// ConfigurationAdapter that answers Configure, and the PomodoroAlarm on the
// same session and sound choices, then hands them over.

#include <QDBusConnection>
#include <QDBusContext>
#include <QList>
#include <QMap>
#include <QMetaProperty>
#include <QObject>
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
    // PropertiesChanged, once per turn of the event loop. Every Q_PROPERTY
    // here is published.
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
    Q_PROPERTY(QVariantMap ChosenProjectLabel READ chosenProjectLabel)
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
    Q_PROPERTY(QVariantMap Presentation READ presentation)
    Q_PROPERTY(QMap<QString, int> PomodoroLengths READ pomodoroLengths)
    Q_PROPERTY(bool PomodoroLengthsEditable READ pomodoroLengthsEditable)
    Q_PROPERTY(QMap<QString, QString> PomodoroLengthErrors READ pomodoroLengthErrors)
    Q_PROPERTY(QMap<QString, QMap<QString, int>> PomodoroLengthLimits READ pomodoroLengthLimits)
    Q_PROPERTY(QMap<QString, QString> Sounds READ sounds)
    Q_PROPERTY(QList<QVariantMap> SoundChoices READ soundCatalogue)
    Q_PROPERTY(QString AlarmError READ alarmError)
    Q_PROPERTY(uint InterfaceVersion READ interfaceVersion)

public:
    static const QString serviceName;
    static const QString objectPath;
    static const QString interfaceName;
    // The InterfaceVersion this service publishes. Raise it by one in a
    // release that adds members to org.tokkl.Timer1. 2 is the first
    // released version; 1 only existed in development builds.
    static constexpr uint version = 2;
    // The settings key of a transition's sound: "Sounds/workToShortRest" and
    // so on.
    static QString soundKey(TransitionKind kind);

    // The client name the service gives the core: the created_with value of
    // the entries it starts. The caller's transport should send it as its
    // User-Agent product too.
    static QString clientName();

    // What the service serves, none of it owned and none of it null. The
    // session must be built on the timer's coordinator, and the alarm, which
    // PreviewSound plays on and AlarmError follows, on the same session and
    // sound choices.
    struct Parts {
        TimerModel *timer = nullptr;
        TimerCoordinator *actions = nullptr;
        PomodoroSession *session = nullptr;
        PomodoroPreferences *preferences = nullptr;
        SoundChoices *sounds = nullptr;
        ConfigurationAdapter *configuration = nullptr;
        PomodoroAlarm *alarm = nullptr;
    };

    explicit TimerService(const Parts &parts, QObject *parent = nullptr);
    ~TimerService() override;

    // Exports the interface on the bus and takes the service name. False when
    // the bus refuses either, for example because another instance owns the
    // name.
    bool registerOn(QDBusConnection bus);

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
    QVariantMap chosenProjectLabel() const;
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
    // StatusPresentation with the GNOME policy, as the button's words read
    // it.
    QVariantMap presentation() const;
    QMap<QString, int> pomodoroLengths() const;
    bool pomodoroLengthsEditable() const;
    QMap<QString, QString> pomodoroLengthErrors() const;
    // PomodoroPreferences::limits(), keyed as PomodoroLengths.
    QMap<QString, QMap<QString, int>> pomodoroLengthLimits() const;
    QMap<QString, QString> sounds() const;
    QList<QVariantMap> soundCatalogue() const;
    // PomodoroAlarm::failure().
    QString alarmError() const;
    uint interfaceVersion() const;

public Q_SLOTS:
    // The org.tokkl.Timer1 methods, called by the generated adaptor.
    bool Start();
    bool Stop();
    bool Pause();
    bool Resume();
    // Start, Stop, Pause and Resume, returning the request's id, or 0 when
    // nothing was sent. RequestFinished follows the server's answer.
    qulonglong RequestStart();
    qulonglong RequestStop();
    qulonglong RequestPause();
    qulonglong RequestResume();
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
    void RefreshProjects();
    bool SetSound(const QString &transition, const QString &soundId);
    bool PreviewSound(const QString &soundId);

Q_SIGNALS:
    // The org.tokkl.Timer1 signal, relayed by the generated adaptor.
    void RequestFinished(qulonglong request, bool ok, const QString &error);

private:
    // The id of a request that sent, or 0. The service follows one at a
    // time, as the timer sends one write at a time.
    qulonglong follow(bool sent);
    void onWriteFinished(bool ok, const QString &message);

    // Every org.tokkl.Timer1 property: the Q_PROPERTYs of this class.
    static const QList<QMetaProperty> &publication();
    // Has the properties read again whenever one of sender's signals fires.
    template<typename Sender, typename... Signals>
    void watch(Sender *sender, Signals... signals)
    {
        (connect(sender, signals, this, &TimerService::markChanged), ...);
    }
    // Follows the offset of the timer's state client, which LocalStartTime
    // reads and no model signal announces.
    void followStateClient();
    // Every property's value, as the adaptor reads it.
    QVariantMap read() const;
    // Something a property reads may have changed: publishes the changes
    // when the event loop next runs.
    void markChanged();
    // Sends PropertiesChanged now for the properties whose value differs
    // from what the bus last saw, if anything was marked.
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
    PomodoroAlarm *m_alarm;
    QDBusConnection m_bus;
    bool m_registered = false;
    QMetaObject::Connection m_offsetWatch;
    // The property values the bus last saw.
    QVariantMap m_published;
    // Something changed since the last publish.
    bool m_dirty = false;
    qulonglong m_lastRequest = 0;
    // The request whose write runs; 0 for none.
    qulonglong m_request = 0;
    bool m_publishQueued = false;
};
}
