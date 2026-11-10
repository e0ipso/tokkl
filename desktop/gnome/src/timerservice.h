#pragma once

// Serves the core's timer and Pomodoro session as org.tokkl.Timer1
// (dbus/org.tokkl.Timer1.xml). The rules stay in the core.

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
class PomodoroAlarm;
class ServiceSettings;
class PomodoroPreferences;
class PomodoroSession;
class SoundChoices;
class TimerController;

class TimerService : public QObject, protected QDBusContext
{
    Q_OBJECT

    // Every Q_PROPERTY here is published. No NOTIFY: changes go out as
    // PropertiesChanged, batched per event-loop turn.
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
    static const QString credentialStoreError;
    static const QString supersededError;
    // Raise by one in each release that adds members to org.tokkl.Timer1.
    static constexpr uint version = 2;
    // "Sounds/workToShortRest" and so on.
    static QString soundKey(TransitionKind kind);

    // The created_with value of started entries; also the transport's
    // User-Agent product.
    static QString clientName();

    // Not owned, none null. The session must wrap the timer, and the alarm
    // must use the same session and sound choices.
    struct Parts {
        TimerController *timer = nullptr;
        PomodoroSession *session = nullptr;
        PomodoroPreferences *preferences = nullptr;
        SoundChoices *sounds = nullptr;
        ServiceSettings *settings = nullptr;
        PomodoroAlarm *alarm = nullptr;
    };

    explicit TimerService(const Parts &parts, QObject *parent = nullptr);
    ~TimerService() override;

    // False when the bus refuses the object or the name (another instance
    // owns it).
    bool registerOn(QDBusConnection bus);

    bool running() const;
    qint64 startTime() const;
    // Corrected by the state client's server clock offset.
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
    QMap<QString, QVariantMap> actions() const;
    QVariantMap presentation() const;
    QMap<QString, int> pomodoroLengths() const;
    bool pomodoroLengthsEditable() const;
    QMap<QString, QString> pomodoroLengthErrors() const;
    QMap<QString, QMap<QString, int>> pomodoroLengthLimits() const;
    QMap<QString, QString> sounds() const;
    QList<QVariantMap> soundCatalogue() const;
    QString alarmError() const;
    uint interfaceVersion() const;

public Q_SLOTS:
    bool Start();
    bool Stop();
    bool Pause();
    bool Resume();
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
    void RequestFinished(qulonglong request, bool ok, const QString &error);

private:
    // One request is followed at a time, as the timer sends one write at a
    // time.
    qulonglong follow(bool sent);
    void onWriteFinished(bool ok, const QString &message);

    static const QList<QMetaProperty> &publication();
    template<typename Sender, typename... Signals>
    void watch(Sender *sender, Signals... signals)
    {
        (connect(sender, signals, this, &TimerService::markChanged), ...);
    }
    QVariantMap read() const;
    void markChanged();
    void publishChanges();
    // Publish before replying: clients read their cached properties when
    // the reply arrives.
    template<typename T>
    T answer(T value)
    {
        publishChanges();
        return value;
    }

    TimerController *m_timer;
    PomodoroSession *m_session;
    PomodoroPreferences *m_preferences;
    SoundChoices *m_sounds;
    ServiceSettings *m_settings;
    PomodoroAlarm *m_alarm;
    QDBusConnection m_bus;
    bool m_registered = false;
    QVariantMap m_published;
    bool m_dirty = false;
    qulonglong m_lastRequest = 0;
    qulonglong m_request = 0;
    bool m_publishQueued = false;
};
}
