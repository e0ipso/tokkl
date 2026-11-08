#pragma once

#include "apitypes.h"
#include "connection.h"
#include "sessionstate.h"

#include <QByteArray>
#include <QDateTime>
#include <QObject>
#include <QPointer>

#include <functional>
#include <optional>

namespace Tokkl
{

class Clock;

// The account's timer state as the server holds it, shared by every desktop
// companion.
//
// When the connection becomes Connected the client reads GET /api/app/timer
// and opens the event stream, which sends the whole state on connect and on
// every change. It keeps the newest state: within a generation a state older
// than the one held is ignored. A new generation (another instance, account
// or secret, or a sign-out) drops the state, its revision and the stream.
//
// When a stream ends or fails the client reads the state again if the stream
// had delivered, and opens a new stream after a wait that starts at 1 s and
// doubles up to 60 s, plus up to a quarter more from the clock's jitter. A
// stream that delivered for 60 s starts the wait over. A timer event that is
// not a readable state, also after good ones, drops the stream: the state is
// read at once and polled until a stream delivers again, and the next stream
// opens after the next wait.
// Until a stream delivers, the state is read every 30 s. A wake, through
// resumed() or a tick more than 10 s late, reads the state and replaces the
// stream at once.
//
// Actions go through the client so it adopts the state they return, the new
// one or, on a 409, the server's current one. After an unknown outcome it
// never sends the action again: it is settling until a read sent after the
// outcome brings a state. A read already on its way does not count, as the
// server may have answered it before the action. While settling, a failed
// read is tried again every 30 s, also while the stream delivers.
//
// A Pomodoro session reads it as a SessionState. A new generation emits
// accountReset() after the state is dropped.
class TimerStateClient : public SessionState
{
    Q_OBJECT

    // A stream is open and has delivered a state.
    Q_PROPERTY(bool streaming READ streaming NOTIFY streamingChanged)
    // A write's outcome is unknown and no read sent since has answered.
    Q_PROPERTY(bool settling READ settling NOTIFY settlingChanged)

public:
    using ActionCallback = Connection::ActionCallback;

    static constexpr int pollIntervalMs = 30000;
    // A tick this late means the machine slept or the clock jumped.
    static constexpr int resumeGapMs = 10000;
    static constexpr int reconnectMinMs = 1000;
    static constexpr int reconnectMaxMs = 60000;
    // A reconnect waits up to this share of its backoff longer, at random.
    static constexpr int reconnectJitterDivisor = 4;
    // The longest wait for a reconnect; a later one means the clock was set
    // back.
    static constexpr int reconnectLongestMs = reconnectMaxMs + reconnectMaxMs / reconnectJitterDivisor;
    // More than any state. A stream that sends more for one event, counted
    // from the end of the last one as the bytes arrive, is dropped before
    // the event is read.
    static constexpr qsizetype maxEventBytes = 1024 * 1024;

    // Neither is owned; both must outlive the client.
    TimerStateClient(Connection *connection, Clock *clock, QObject *parent = nullptr);
    ~TimerStateClient() override;

    Connection *connection() const;
    // The clock the client was given; a timer or session built on the
    // client can share it.
    Clock *clock() const;
    const std::optional<TimerState> &state() const override;
    bool streaming() const;
    bool settling() const override;
    // The server's clock minus this device's, from the server_time of the
    // state held. 0 without one.
    qint64 serverOffsetMs() const override;
    // This device's clock corrected by serverOffsetMs().
    QDateTime serverNow() const override;

    // The connection's timer actions. The ones that apply to a revision send
    // the one held, and are refused without sending while no state is held.
    //
    // A start, or a stop of the running entry, entryId. On a server without
    // timer-actions they go to v9 and answer with the entry instead of the
    // state; see Connection::startTimer(). The caller settles that.
    void start(const StartEntry &entry, ActionCallback done = {});
    void stop(qint64 entryId, ActionCallback done = {});
    void pause(ActionCallback done = {});
    void resume(ActionCallback done = {});
    void discard(ActionCallback done = {});
    // Edits the running entry; see Connection::editTimer().
    void edit(const TimeEntryUpdate &update, ActionCallback done = {});
    void startPomodoro(const PomodoroStart &start, ActionCallback done = {}) override;
    void nextPhase(ActionCallback done = {}) override;
    void endPomodoro(ActionCallback done = {}) override;

    // A write made elsewhere, such as a v9 edit, had an unknown outcome or
    // answered with less than the state: read the state and stay settling
    // until a read sent from now on answers. The actions above do this
    // themselves for an unknown outcome.
    void settle();

public Q_SLOTS:
    // Reads the state, after the read on its way if there is one.
    void refresh();
    // The session woke from sleep: read the state and open a new stream.
    void resumed();

Q_SIGNALS:
    // stateChanged(), settlingChanged() and accountReset() are SessionState's.
    void streamingChanged();
    // serverOffsetMs() changed. A state that changes nothing else, such as
    // the same revision read again after this machine's clock was set, can
    // still move it.
    void offsetChanged();

private:
    // The fields of the event being read from the stream.
    struct PendingEvent {
        QByteArray type;
        QByteArray data;
        bool hasData = false;
        // The bytes of its lines read so far, line ends included.
        qsizetype bytes = 0;
    };

    bool readable() const;
    // A read sent from now on. With fresh, a read on its way does not count,
    // as it may have been answered before a change.
    void requestRead(bool fresh);
    void onConnectionStateChanged();
    void onGenerationChanged();
    void onTick();
    void openStream();
    void closeStream();
    void scheduleReconnect();
    void onStreamData(const QByteArray &data);
    void onStreamEnded();
    void readLine(QByteArrayView line);
    // Drops a stream that sent more than maxEventBytes for one event.
    void dropOversizedStream();
    // Drops a stream that sent a timer event that is not a timer state,
    // reads the state and reconnects after the backoff.
    void dropUnreadableStream();
    void dispatchEvent();
    bool adopt(const TimerState &state);
    void setStreaming(bool streaming);
    void setSettling(bool settling);
    void setOffset(qint64 offsetMs);
    ActionCallback adopting(ActionCallback done);
    // Sends action with the revision held, adopting what it answers.
    void withRevision(const std::function<void(Connection &, qint64, ActionCallback)> &action, ActionCallback done);
    void refuseLater(const ActionCallback &done, const QString &message);

    QPointer<Connection> m_connection;
    QPointer<Clock> m_clock;
    quint64 m_generation = 0;
    Connection::State m_lastState = Connection::Unconfigured;
    bool m_started = false; // read and streamed in this generation

    std::optional<TimerState> m_state;
    qint64 m_offsetMs = 0;
    bool m_reading = false;
    bool m_readAgain = false;
    quint64 m_readsSent = 0;
    // Settling until a read numbered above m_settleAfter brings a state.
    bool m_settling = false;
    quint64 m_settleAfter = 0;
    QDateTime m_nextPoll;
    QDateTime m_lastTick;

    QPointer<PendingStream> m_stream;
    quint64 m_streamSerial = 0; // changes whenever the stream is replaced or closed
    QByteArray m_buffer;
    PendingEvent m_event;
    bool m_streaming = false;
    QDateTime m_streamingSince;
    int m_backoffMs = reconnectMinMs;
    QDateTime m_reconnectAt;
};

}
