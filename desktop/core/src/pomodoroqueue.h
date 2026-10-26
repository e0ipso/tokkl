#pragma once

#include "apitypes.h"
#include "clock.h"
#include "connection.h"
#include "pomodororecord.h"
#include "pomodorostore.h"

#include <QDateTime>
#include <QList>
#include <QObject>
#include <QPointer>
#include <QString>

#include <optional>

namespace Tokkl
{

// Saves ended pomodoros as stopped time entries, and loses none and saves
// none twice. The rules are the web app's.
//
// Each item lives in the store under its owner until the server has it. Before
// every POST the item is written back with the attempt counted and the next
// try scheduled, so a crash before the reply still leaves a record of the
// attempt. An item tried before is posted only after a read of the entries
// in its span finds no entry with the same start and stop; one that does is
// removed without a POST. A 2xx removes the item. A 4xx other than 401, 408
// and 429 removes it too and publishes the server's message. Any other
// failure keeps the item until its retryAt, which backs off from 5 s to 5
// min.
//
// Items go out one at a time, only for the connection's current owner. Due
// items are looked for on clock ticks, and once the connection is Connected
// every item is tried whether due or not. Replies of an earlier generation
// never arrive, so a new generation ends the run in progress.
//
// The queue keeps no copy of the items: every change reads the record,
// changes the queue part and writes it back.
class PomodoroQueue : public QObject
{
    Q_OBJECT

    // The last message for the user, such as why the server refused an
    // item. It stays until clearMessage() or the next message.
    Q_PROPERTY(QString message READ message NOTIFY messageChanged)

public:
    // Uses the connection, the clock and the store, which it does not own.
    PomodoroQueue(Connection *connection, Clock *clock, PomodoroStore *store, QObject *parent = nullptr);

    QString message() const;
    Q_INVOKABLE void clearMessage();

    // Writes the session, which replaces the stored one, and the item to the
    // item's owner's record in one write, then tries the owner's due items,
    // the new one among them when its retryAt has come. An item whose id is
    // already queued is left as it is. Returns false, with nothing written,
    // for an item without an owner or workspace, and when the store refused
    // the write.
    bool enqueue(const UnsavedPomodoro &item, const std::optional<PomodoroSessionRecord> &session);

    // The sign-out rule: posts each item of the connection's owner that has
    // never been tried, sends nothing for the others, and removes every item
    // of that owner at once, without waiting for the replies. Call it while
    // the connection still has the context the items belong to.
    void flushForSignOut();

Q_SIGNALS:
    void messageChanged();

private:
    // An item as it was when a run was planned. It is tried only if it is
    // still stored with the same attempt count.
    struct Planned {
        QString id;
        int attempts = 0;
    };

    void onConnectionChanged();
    void onGenerationChanged();
    void onTick();
    // Plans a run over the owner's items that are due, or over all of them
    // when forced, and starts it unless one is in progress.
    void run(bool force);
    // Tries the next planned item, or ends the run.
    void next();
    void attempt(const UnsavedPomodoro &item);
    void post(const UnsavedPomodoro &item);
    void finishPost(const UnsavedPomodoro &item, const ApiResult<TimeEntry> &result);
    // Removes the item from its owner's record.
    void remove(const UnsavedPomodoro &item);
    // Reads the earliest retryAt of the owner's items for the tick check.
    void readNextDue();
    bool canPost() const;
    QString owner() const;
    PomodoroRecord load(const QString &owner) const;
    bool save(const QString &owner, const PomodoroRecord &record);
    void setMessage(const QString &message);

    QPointer<Connection> m_connection;
    QPointer<Clock> m_clock;
    QPointer<PomodoroStore> m_store;
    QString m_message;
    QString m_owner;
    // Connected as last seen; reset by a new generation, so the next account
    // gets its items tried too.
    bool m_online = false;

    // A run in progress: the items still to try, and whether a request is
    // waiting for its reply.
    bool m_running = false;
    QList<Planned> m_planned;
    // A run asked for while one was in progress, and whether it was forced.
    bool m_runAgain = false;
    bool m_runAgainForced = false;
    // The earliest retryAt among the owner's items; invalid when there are
    // none.
    QDateTime m_nextDue;
};

}
