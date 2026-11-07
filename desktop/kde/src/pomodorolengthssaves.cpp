#include "pomodorolengthssaves.h"

#include "connection.h"
#include "pomodoropreferences.h"

#include <QCoreApplication>

namespace Tokkl
{

namespace
{
// The server's or the connection's reason, first the one that names no
// length.
QString refusalOf(const PomodoroPreferences *preferences)
{
    const QString reasons[] = {
        preferences->errorString(),
        preferences->workMinutesError(),
        preferences->shortRestMinutesError(),
        preferences->longRestMinutesError(),
        preferences->longRestEveryError(),
    };
    for (const QString &reason : reasons) {
        if (!reason.isEmpty()) {
            return reason;
        }
    }
    return QString();
}
}

PomodoroLengthsSaves *PomodoroLengthsSaves::instance()
{
    static QPointer<PomodoroLengthsSaves> saves;
    if (!saves) {
        saves = new PomodoroLengthsSaves(QCoreApplication::instance());
    }
    return saves;
}

QString PomodoroLengthsSaves::accountKey(const Connection *connection)
{
    const std::optional<Me> account = connection ? connection->account() : std::nullopt;
    return account ? connection->instanceUrl() + QLatin1Char('\n') + QString::number(account->id) : QString();
}

bool PomodoroLengthsSaves::save(Connection *connection, PomodoroPreferences *preferences, int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery)
{
    if (!preferences || m_waiting.contains(preferences)) {
        return false;
    }
    const QString key = accountKey(connection);
    setRefusal(key, QString());
    if (!preferences->save(workMinutes, shortRestMinutes, longRestMinutes, longRestEvery)) {
        return false;
    }
    m_waiting.insert(preferences, key);
    connect(preferences, &PomodoroPreferences::stateChanged, this, [this, preferences] {
        onStateChanged(preferences);
    });
    connect(preferences, &QObject::destroyed, this, [this, preferences] {
        m_waiting.remove(preferences);
        m_kept.remove(preferences);
    });
    return true;
}

void PomodoroLengthsSaves::keepUntilAnswered(Connection *connection, PomodoroPreferences *preferences)
{
    if (!m_waiting.contains(preferences)) {
        return;
    }
    connection->setParent(this);
    preferences->setParent(this);
    m_kept.insert(preferences, connection);
}

QString PomodoroLengthsSaves::refusal(const QString &accountKey) const
{
    return m_refusals.value(accountKey);
}

void PomodoroLengthsSaves::onStateChanged(PomodoroPreferences *preferences)
{
    if (preferences->isSaving() || !m_waiting.contains(preferences)) {
        return;
    }
    const QString key = m_waiting.take(preferences);
    disconnect(preferences, nullptr, this, nullptr);
    setRefusal(key, refusalOf(preferences));
    Q_EMIT answered(preferences);
    if (m_kept.contains(preferences)) {
        // The page that sent it is gone.
        const QPointer<Connection> connection = m_kept.take(preferences);
        preferences->deleteLater();
        if (connection) {
            connection->deleteLater();
        }
    }
}

void PomodoroLengthsSaves::setRefusal(const QString &accountKey, const QString &refusal)
{
    if (accountKey.isEmpty() || m_refusals.value(accountKey) == refusal) {
        return;
    }
    if (refusal.isEmpty()) {
        m_refusals.remove(accountKey);
    } else {
        m_refusals.insert(accountKey, refusal);
    }
    Q_EMIT refusalChanged(accountKey);
}

PomodoroLengthsSaveStatus::PomodoroLengthsSaveStatus(QObject *parent)
    : QObject(parent)
{
    connect(PomodoroLengthsSaves::instance(), &PomodoroLengthsSaves::refusalChanged, this, &PomodoroLengthsSaveStatus::update);
}

Connection *PomodoroLengthsSaveStatus::connection() const
{
    return m_connection;
}

void PomodoroLengthsSaveStatus::setConnection(Connection *connection)
{
    if (connection == m_connection) {
        return;
    }
    if (m_connection) {
        disconnect(m_connection, nullptr, this, nullptr);
    }
    m_connection = connection;
    if (m_connection) {
        connect(m_connection, &Connection::accountChanged, this, &PomodoroLengthsSaveStatus::update);
        connect(m_connection, &Connection::stateChanged, this, &PomodoroLengthsSaveStatus::update);
    }
    Q_EMIT connectionChanged();
    update();
}

QString PomodoroLengthsSaveStatus::refusal() const
{
    return m_refusal;
}

void PomodoroLengthsSaveStatus::update()
{
    const QString refusal = PomodoroLengthsSaves::instance()->refusal(PomodoroLengthsSaves::accountKey(m_connection));
    if (refusal != m_refusal) {
        m_refusal = refusal;
        Q_EMIT refusalChanged();
    }
}

}
