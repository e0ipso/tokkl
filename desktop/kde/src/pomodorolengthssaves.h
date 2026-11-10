#pragma once

// OK can destroy the Configure page before a save is answered, so this
// process-wide object keeps the connection and holds any refusal for the panel.

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QString>

namespace Tokkl
{

class Connection;
class PomodoroPreferences;

class PomodoroLengthsSaves : public QObject
{
    Q_OBJECT

public:
    static PomodoroLengthsSaves *instance();

    // Instance plus validated account id; empty before validation.
    static QString accountKey(const Connection *connection);

    // preferences must belong to connection. A new save clears the
    // account's last refusal.
    bool save(Connection *connection, PomodoroPreferences *preferences, int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery);
    // Takes ownership only while a save waits; otherwise the caller deletes
    // both.
    void keepUntilAnswered(Connection *connection, PomodoroPreferences *preferences);

    QString refusal(const QString &accountKey) const;

Q_SIGNALS:
    void refusalChanged(const QString &accountKey);
    void answered(Tokkl::PomodoroPreferences *preferences);

private:
    using QObject::QObject;

    void onStateChanged(PomodoroPreferences *preferences);
    void setRefusal(const QString &accountKey, const QString &refusal);

    QHash<PomodoroPreferences *, QString> m_waiting;
    QHash<PomodoroPreferences *, QPointer<Connection>> m_kept;
    QHash<QString, QString> m_refusals;
};

class PomodoroLengthsSaveStatus : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::Connection *connection READ connection WRITE setConnection NOTIFY connectionChanged)
    Q_PROPERTY(QString refusal READ refusal NOTIFY refusalChanged)

public:
    explicit PomodoroLengthsSaveStatus(QObject *parent = nullptr);

    Connection *connection() const;
    void setConnection(Connection *connection);
    QString refusal() const;

Q_SIGNALS:
    void connectionChanged();
    void refusalChanged();

private:
    void update();

    QPointer<Connection> m_connection;
    QString m_refusal;
};

}
