#pragma once

#include "apitypes.h"
#include "connection.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <array>

namespace Tokkl
{

// The account's Pomodoro lengths for a settings pane and for starting a
// session: the four pomodoro_* preferences the web app and Android share.
//
// The lengths are read each time the connection becomes Connected and on
// refresh(). Without a usable connection the lengths last read for the
// account show, and cannot be edited. Until a read answers for an account,
// the defaults show. A session takes its lengths on the server, so these are
// only for showing and editing.
//
// save() posts only the lengths that differ from the ones shown. A 400 whose
// message names one of the four keys is that field's error; any other failure
// is the general error. A read issued while a save runs, or before one
// started, does not replace what the save returned.
//
// Everything is tied to the connection's generation. A new one clears the
// errors and the save in flight, shows the defaults when the owner changed,
// and replies issued under an earlier one change nothing.
class PomodoroPreferences : public QObject
{
    Q_OBJECT

    Q_PROPERTY(int workMinutes READ workMinutes NOTIFY changed)
    Q_PROPERTY(int shortRestMinutes READ shortRestMinutes NOTIFY changed)
    Q_PROPERTY(int longRestMinutes READ longRestMinutes NOTIFY changed)
    Q_PROPERTY(int longRestEvery READ longRestEvery NOTIFY changed)
    // A validated account is connected, so save() can post.
    Q_PROPERTY(bool editable READ isEditable NOTIFY stateChanged)
    Q_PROPERTY(bool saving READ isSaving NOTIFY stateChanged)
    // The server's message for a value it refused, per field.
    Q_PROPERTY(QString workMinutesError READ workMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString shortRestMinutesError READ shortRestMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString longRestMinutesError READ longRestMinutesError NOTIFY stateChanged)
    Q_PROPERTY(QString longRestEveryError READ longRestEveryError NOTIFY stateChanged)
    // A failed read, or a failed save that names no field.
    Q_PROPERTY(QString errorString READ errorString NOTIFY stateChanged)

public:
    // Uses the connection, which it does not own.
    explicit PomodoroPreferences(Connection *connection, QObject *parent = nullptr);

    PomodoroConfig config() const;
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

    // Clears the errors and posts the lengths that differ from the ones
    // shown. Returns true when a request was sent; false while not editable
    // or saving, and when nothing differs.
    Q_INVOKABLE bool save(int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery);

public Q_SLOTS:
    // Reads the lengths again. refreshed() tells how it went.
    void refresh();

Q_SIGNALS:
    // The lengths changed.
    void changed();
    // editable, saving or an error changed.
    void stateChanged();
    // A read of the current generation ended, also one the connection
    // started. When ok is false the lengths shown are the last known ones.
    void refreshed(bool ok);

private:
    void onConnectionChanged();
    void onGenerationChanged();
    // Shows the defaults when the connection's owner changed.
    void followOwner();
    void fetch();
    void finishRead(const ApiResult<PomodoroConfig> &result, quint64 number, bool current);
    void finishSave(const ApiResult<PomodoroConfig> &result);
    void setConfig(const PomodoroConfig &config);
    // Returns true when there was an error to clear.
    bool clearErrors();

    QPointer<Connection> m_connection;
    QString m_owner;
    PomodoroConfig m_config;
    // Connected with a validated account, as last seen. Reset by a new
    // generation, so the next account reads its lengths too.
    bool m_online = false;

    bool m_saving = false;
    std::array<QString, 4> m_fieldErrors;
    QString m_error;

    // Reads are numbered. A reply is applied only when no newer read was,
    // and no save ran when it was issued or started since.
    quint64 m_readsIssued = 0;
    quint64 m_lastAppliedRead = 0;
    quint64 m_savesStarted = 0;
};

}
