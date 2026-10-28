#include "pomodoropreferences.h"

namespace Tokkl
{

namespace
{
constexpr PomodoroField fields[] = {
    PomodoroField::WorkMinutes,
    PomodoroField::ShortRestMinutes,
    PomodoroField::LongRestMinutes,
    PomodoroField::LongRestEvery,
};

// The field a refused save names. The server answers a value it cannot use
// with 400 "Invalid <key>: expected an integer from <min> to <max>".
std::optional<PomodoroField> refusedField(const ApiError &error)
{
    if (error.kind != ApiError::Kind::Client || error.status != 400) {
        return std::nullopt;
    }
    for (const PomodoroField field : fields) {
        if (error.message.contains(pomodoroPreferenceKey(field))) {
            return field;
        }
    }
    return std::nullopt;
}
}

PomodoroPreferences::PomodoroPreferences(Connection *connection, QObject *parent)
    : QObject(parent)
    , m_connection(connection)
{
    if (m_connection) {
        connect(m_connection, &Connection::stateChanged, this, &PomodoroPreferences::onConnectionChanged);
        // The account can change while the state stays Connected.
        connect(m_connection, &Connection::accountChanged, this, &PomodoroPreferences::onConnectionChanged);
        connect(m_connection, &Connection::generationChanged, this, &PomodoroPreferences::onGenerationChanged);
    }
    onConnectionChanged();
}

PomodoroConfig PomodoroPreferences::config() const
{
    return m_config;
}

int PomodoroPreferences::workMinutes() const
{
    return m_config.workMinutes;
}

int PomodoroPreferences::shortRestMinutes() const
{
    return m_config.shortRestMinutes;
}

int PomodoroPreferences::longRestMinutes() const
{
    return m_config.longRestMinutes;
}

int PomodoroPreferences::longRestEvery() const
{
    return m_config.longRestEvery;
}

bool PomodoroPreferences::isEditable() const
{
    return m_connection && m_connection->state() == Connection::Connected && m_connection->canWrite();
}

bool PomodoroPreferences::isSaving() const
{
    return m_saving;
}

QString PomodoroPreferences::fieldError(PomodoroField field) const
{
    return m_fieldErrors.at(std::size_t(field));
}

QString PomodoroPreferences::workMinutesError() const
{
    return fieldError(PomodoroField::WorkMinutes);
}

QString PomodoroPreferences::shortRestMinutesError() const
{
    return fieldError(PomodoroField::ShortRestMinutes);
}

QString PomodoroPreferences::longRestMinutesError() const
{
    return fieldError(PomodoroField::LongRestMinutes);
}

QString PomodoroPreferences::longRestEveryError() const
{
    return fieldError(PomodoroField::LongRestEvery);
}

QString PomodoroPreferences::errorString() const
{
    return m_error;
}

bool PomodoroPreferences::save(int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery)
{
    if (!isEditable() || m_saving) {
        return false;
    }
    PomodoroConfigUpdate update;
    if (workMinutes != m_config.workMinutes) {
        update.workMinutes = workMinutes;
    }
    if (shortRestMinutes != m_config.shortRestMinutes) {
        update.shortRestMinutes = shortRestMinutes;
    }
    if (longRestMinutes != m_config.longRestMinutes) {
        update.longRestMinutes = longRestMinutes;
    }
    if (longRestEvery != m_config.longRestEvery) {
        update.longRestEvery = longRestEvery;
    }
    const bool cleared = clearErrors();
    if (update.isEmpty()) {
        if (cleared) {
            Q_EMIT stateChanged();
        }
        return false;
    }
    m_saving = true;
    ++m_savesStarted;
    Q_EMIT stateChanged();

    QPointer<PomodoroPreferences> self(this);
    m_connection->savePreferences(update, [self](const ApiResult<PomodoroConfig> &result) {
        if (self) {
            self->finishSave(result);
        }
    });
    return true;
}

void PomodoroPreferences::refresh()
{
    fetch();
}

void PomodoroPreferences::onConnectionChanged()
{
    followOwner();
    const bool online = m_connection && m_connection->state() == Connection::Connected && m_connection->isConnected();
    const bool cameOnline = online && !m_online;
    m_online = online;
    Q_EMIT stateChanged();
    if (cameOnline) {
        fetch();
    }
}

void PomodoroPreferences::onGenerationChanged()
{
    // A save or read in flight never answers now.
    m_saving = false;
    clearErrors();
    m_online = false;
    onConnectionChanged();
}

void PomodoroPreferences::followOwner()
{
    const QString owner = m_connection ? m_connection->owner() : QString();
    if (owner == m_owner) {
        return;
    }
    m_owner = owner;
    setConfig(PomodoroConfig());
}

void PomodoroPreferences::fetch()
{
    if (!m_connection) {
        QMetaObject::invokeMethod(
            this,
            [this] {
                Q_EMIT refreshed(false);
            },
            Qt::QueuedConnection);
        return;
    }
    const quint64 number = ++m_readsIssued;
    const bool savingAtIssue = m_saving;
    const quint64 savesAtIssue = m_savesStarted;
    QPointer<PomodoroPreferences> self(this);
    m_connection->fetchPreferences([self, number, savingAtIssue, savesAtIssue](const ApiResult<PomodoroConfig> &result) {
        if (self) {
            self->finishRead(result, number, !savingAtIssue && savesAtIssue == self->m_savesStarted);
        }
    });
}

void PomodoroPreferences::finishRead(const ApiResult<PomodoroConfig> &result, quint64 number, bool current)
{
    if (!result.ok()) {
        m_error = result.error.message;
        Q_EMIT stateChanged();
        Q_EMIT refreshed(false);
        return;
    }
    if (current && number > m_lastAppliedRead) {
        m_lastAppliedRead = number;
        setConfig(*result.value);
    }
    if (!m_error.isEmpty()) {
        m_error.clear();
        Q_EMIT stateChanged();
    }
    Q_EMIT refreshed(true);
}

void PomodoroPreferences::finishSave(const ApiResult<PomodoroConfig> &result)
{
    m_saving = false;
    if (result.ok()) {
        setConfig(*result.value);
    } else if (const std::optional<PomodoroField> field = refusedField(result.error)) {
        m_fieldErrors.at(std::size_t(*field)) = result.error.message;
    } else {
        m_error = result.error.message;
    }
    Q_EMIT stateChanged();
}

void PomodoroPreferences::setConfig(const PomodoroConfig &config)
{
    if (config == m_config) {
        return;
    }
    m_config = config;
    Q_EMIT changed();
}

bool PomodoroPreferences::clearErrors()
{
    bool had = !m_error.isEmpty();
    m_error.clear();
    for (QString &error : m_fieldErrors) {
        had = had || !error.isEmpty();
        error.clear();
    }
    return had;
}

}
