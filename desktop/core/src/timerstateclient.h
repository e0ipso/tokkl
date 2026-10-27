#pragma once

#include "apitypes.h"
#include "connection.h"

#include <QByteArray>
#include <QDateTime>
#include <QObject>
#include <QPointer>

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
// doubles up to 60 s. A stream that delivered for 60 s starts the wait over.
// Until a stream delivers, the state is read every 30 s. A wake, through
// resumed() or a tick more than 10 s late, reads the state and replaces the
// stream at once.
//
// Actions go through the client so it adopts the state they return, the new
// one or, on a 409, the server's current one. After an unknown outcome it
// reads the state; it never sends the action again.
class TimerStateClient : public QObject
{
    Q_OBJECT

    // A stream is open and has delivered a state.
    Q_PROPERTY(bool streaming READ streaming NOTIFY streamingChanged)

public:
    using ActionCallback = Connection::ActionCallback;

    static constexpr int pollIntervalMs = 30000;
    // A tick this late means the machine slept or the clock jumped.
    static constexpr int resumeGapMs = 10000;
    static constexpr int reconnectMinMs = 1000;
    static constexpr int reconnectMaxMs = 60000;
    // More than any state; a stream that sends more without an event end is
    // dropped.
    static constexpr qsizetype maxEventBytes = 1024 * 1024;

    // Neither is owned; both must outlive the client.
    TimerStateClient(Connection *connection, Clock *clock, QObject *parent = nullptr);
    ~TimerStateClient() override;

    const std::optional<TimerState> &state() const;
    bool streaming() const;
    // The server's clock minus this device's, from the server_time of the
    // state held. 0 without one.
    qint64 serverOffsetMs() const;
    // This device's clock corrected by serverOffsetMs().
    QDateTime serverNow() const;

    // The connection's timer actions. The ones that apply to a revision send
    // the one held, and are refused without sending while no state is held.
    void pause(ActionCallback done = {});
    void resume(ActionCallback done = {});
    void discard(ActionCallback done = {});
    void startPomodoro(const PomodoroStart &start, ActionCallback done = {});
    void nextPhase(ActionCallback done = {});
    void endPomodoro(ActionCallback done = {});

public Q_SLOTS:
    // Reads the state, after the read on its way if there is one.
    void refresh();
    // The session woke from sleep: read the state and open a new stream.
    void resumed();

Q_SIGNALS:
    // A state at least as new as the one held arrived, or the state was
    // dropped.
    void stateChanged();
    void streamingChanged();

private:
    // The fields of the event being read from the stream.
    struct PendingEvent {
        QByteArray type;
        QByteArray data;
        bool hasData = false;
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
    void dispatchEvent();
    bool adopt(const TimerState &state);
    void setStreaming(bool streaming);
    ActionCallback adopting(ActionCallback done);
    void withRevision(void (Connection::*action)(qint64, ActionCallback), ActionCallback done);
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
