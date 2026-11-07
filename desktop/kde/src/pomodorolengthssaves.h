#pragma once

// The Pomodoro lengths the Configure page saves, followed for the whole
// plasmashell process. Plasma runs the Configure dialog and the panel item in
// QML engines of their own and calls the page's saveConfig() only once it
// has saved the page's settings, so OK can close the dialog, and destroy the
// page, before the server answers. The save therefore belongs to this
// process-wide object: it keeps the page's connection and preferences client
// until the answer comes, and keeps a refusal for the panel, which shows it
// in its menu and tooltip.

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
    // The one object of the process, owned by the application.
    static PomodoroLengthsSaves *instance();

    // What names an account here: the connection's instance and the id of
    // the account it validated. Empty while the connection knows none.
    static QString accountKey(const Connection *connection);

    // Sends the lengths through preferences, which must belong to
    // connection, and follows the answer. False, as from
    // PomodoroPreferences::save(), when nothing was sent. A new save clears
    // the account's last refusal.
    bool save(Connection *connection, PomodoroPreferences *preferences, int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery);
    // Takes connection and preferences over while a save from them waits
    // for its answer, and deletes both once it has come. Otherwise it does
    // nothing, and the caller deletes them.
    void keepUntilAnswered(Connection *connection, PomodoroPreferences *preferences);

    // Why the account's last save was refused, as the server or the
    // connection said; empty when it was accepted or nothing was refused.
    QString refusal(const QString &accountKey) const;

Q_SIGNALS:
    void refusalChanged(const QString &accountKey);
    // A save from preferences has its answer.
    void answered(Tokkl::PomodoroPreferences *preferences);

private:
    using QObject::QObject;

    void onStateChanged(PomodoroPreferences *preferences);
    void setRefusal(const QString &accountKey, const QString &refusal);

    // The account of each save that waits for its answer.
    QHash<PomodoroPreferences *, QString> m_waiting;
    // What the clients handed over, to delete once answered.
    QHash<PomodoroPreferences *, QPointer<Connection>> m_kept;
    QHash<QString, QString> m_refusals;
};

// The last refusal of a Pomodoro lengths save for the panel's account, from
// PomodoroLengthsSaves; the panel shows it. QML's TokklLengthsSaveStatus.
class PomodoroLengthsSaveStatus : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::Connection *connection READ connection WRITE setConnection NOTIFY connectionChanged)
    // Empty when the last save of the account was accepted, or none was
    // refused.
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
