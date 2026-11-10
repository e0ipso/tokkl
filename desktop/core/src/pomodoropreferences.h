#pragma once

#include "apitypes.h"
#include "connection.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <array>

namespace Tokkl
{

// For showing and editing only; a session takes its lengths on the server.
// A read issued before or during a save never replaces what the save returned.
class PomodoroPreferences : public QObject
{
    Q_OBJECT

    Q_PROPERTY(int workMinutes READ workMinutes NOTIFY changed)
    Q_PROPERTY(int shortRestMinutes READ shortRestMinutes NOTIFY changed)
    Q_PROPERTY(int longRestMinutes READ longRestMinutes NOTIFY changed)
    Q_PROPERTY(int longRestEvery READ longRestEvery NOTIFY changed)
    Q_PROPERTY(bool editable READ isEditable NOTIFY stateChanged)
    Q_PROPERTY(bool saving READ isSaving NOTIFY stateChanged)
    // The server's message for a value it refused.
    Q_PROPERTY(QString workMinutesError READ workMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString shortRestMinutesError READ shortRestMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString longRestMinutesError READ longRestMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString longRestEveryError READ longRestEveryError NOTIFY stateChanged)
    // A failed read, or a failed save that names no field.
    Q_PROPERTY(QString errorString READ errorString NOTIFY stateChanged)
    Q_PROPERTY(QVariantMap limits READ limits NOTIFY limitsChanged)

public:
    // The connection is not owned.
    explicit PomodoroPreferences(Connection *connection, QObject *parent = nullptr);

    PomodoroConfig config() const;
    // Connection::owner() of the lengths shown; empty for the defaults. An edit
    // is meant for this account only.
    QString owner() const;
    PomodoroLimits pomodoroLimits() const;
    QVariantMap limits() const;
    int workMinutes() const;
    int shortRestMinutes() const;
    int longRestMinutes() const;
    int longRestEvery() const;

    bool isEditable() const;
    bool isSaving() const;
    QString fieldError(PomodoroField field) const;
    QString workMinutesError() const;
    QString shortRestMinutesError() const;
    QString longRestMinutesError() const;
    QString longRestEveryError() const;
    QString errorString() const;

    // Posts only the lengths that differ from the ones shown. False while not
    // editable, while saving, or when nothing differs.
    Q_INVOKABLE bool save(int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery);

public Q_SLOTS:
    void refresh();

Q_SIGNALS:
    void changed();
    void limitsChanged();
    void stateChanged();
    // Also for a read the connection started. On failure the last known lengths
    // stay.
    void refreshed(bool ok);

private:
    void onConnectionChanged();
    void onGenerationChanged();
    void followOwner();
    void followLimits();
    void fetch();
    void finishRead(const ApiResult<PomodoroConfig> &result, quint64 number, bool current);
    void finishSave(const ApiResult<PomodoroConfig> &result);
    void setConfig(const PomodoroConfig &config);
    // True when there was an error to clear.
    bool clearErrors();

    QPointer<Connection> m_connection;
    QString m_owner;
    PomodoroLimits m_limits = PomodoroLimits::placeholder();
    PomodoroConfig m_config;
    // Reset by a new generation, so the next account reads its lengths too.
    bool m_online = false;

    bool m_saving = false;
    std::array<QString, 4> m_fieldErrors;
    QString m_error;

    // A reply applies only if no newer read applied and no save ran when it was
    // issued or started since.
    quint64 m_readsIssued = 0;
    quint64 m_lastAppliedRead = 0;
    quint64 m_savesStarted = 0;
};

}
