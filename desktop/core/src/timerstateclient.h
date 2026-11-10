#pragma once

#include "apitypes.h"
#include "clock.h"
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

// Within a generation an older state is ignored. After an unknown outcome
// nothing is resent; a read sent after the outcome settles it.
class TimerStateClient : public SessionState
{
    Q_OBJECT

    Q_PROPERTY(bool streaming READ streaming NOTIFY streamingChanged)
    // A write's outcome is unknown and no read sent since has answered.
    Q_PROPERTY(bool settling READ settling NOTIFY settlingChanged)

public:
    using ActionCallback = Connection::ActionCallback;

    static constexpr int pollIntervalMs = 30000;
    // A tick this late means the machine slept or the clock jumped.
    static constexpr int resumeGapMs = 10000;
    static constexpr int reconnectMinMs = retryMinMs;
    static constexpr int reconnectMaxMs = 60000;
    // A later reconnect than this means the clock was set back.
    static constexpr int reconnectLongestMs = reconnectMaxMs + reconnectMaxMs / retryJitterDivisor;
    // A stream that sends more for one event is dropped before the event is
    // read.
    static constexpr qsizetype maxEventBytes = 1024 * 1024;

    // Neither is owned; both must outlive the client.
    TimerStateClient(Connection &connection, Clock &clock, QObject *parent = nullptr);
    ~TimerStateClient() override;

    Connection *connection() const;
    Clock &clock() const;
    const std::optional<TimerState> &state() const override;
    bool streaming() const;
    bool settling() const override;
    // From the server_time of the state held; 0 without one.
    qint64 serverOffsetMs() const override;
    QDateTime serverNow() const override;

    // Revisioned actions send the revision held and are refused without sending
    // while no state is held.
    void start(const StartEntry &entry, ActionCallback done = {});
    void stop(ActionCallback done = {});
    void pause(ActionCallback done = {});
    void resume(ActionCallback done = {});
    void discard(ActionCallback done = {});
    // Needs no state held; see Connection::editTimer().
    void edit(qint64 entryId, const TimeEntryUpdate &update, ActionCallback done = {});
    void startPomodoro(const PomodoroStart &start, ActionCallback done = {}) override;
    void nextPhase(ActionCallback done = {}) override;
    void endPomodoro(ActionCallback done = {}) override;

    // For a write in flight when the workspace was lost. The actions settle by
    // themselves after an unknown outcome.
    void settle();

public Q_SLOTS:
    void refresh();
    // One wake that both this and a late tick report counts once.
    void resumed();

Q_SIGNALS:
    void streamingChanged();
    // Can change without any other state change, e.g. after the local clock was
    // set.
    void offsetChanged();

private:
    struct PendingEvent {
        QByteArray type;
        QByteArray data;
        bool hasData = false;
        // Line ends included.
        qsizetype bytes = 0;
    };

    bool readable() const;
    // With fresh, a read on its way does not count: it may have been answered
    // before a change.
    void requestRead(bool fresh);
    void onConnectionStateChanged();
    void onGenerationChanged();
    void onTick();
    void wake(const QDateTime &now);
    void openStream();
    void closeStream();
    void scheduleReconnect();
    void onStreamData(const QByteArray &data);
    void onStreamEnded();
    void readLine(QByteArrayView line);
    void readRetry(QByteArrayView value);
    void dropOversizedStream();
    void dropUnreadableStream();
    void dispatchEvent();
    bool adopt(const TimerState &state);
    void setStreaming(bool streaming);
    void setSettling(bool settling);
    void setOffset(qint64 offsetMs);
    ActionCallback adopting(ActionCallback done);
    void withRevision(const std::function<void(Connection &, qint64, ActionCallback)> &action, ActionCallback done);
    void refuseLater(const ActionCallback &done, const QString &message);

    Connection &m_connection;
    Clock &m_clock;
    quint64 m_generation;
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
    QDateTime m_wokeAt;

    QPointer<PendingStream> m_stream;
    quint64 m_streamSerial = 0; // changes whenever the stream is replaced or closed
    QByteArray m_buffer;
    PendingEvent m_event;
    bool m_streaming = false;
    QDateTime m_streamingSince;
    int m_backoffMs = reconnectMinMs;
    // 0 until a stream sends a retry field.
    int m_retryFloorMs = 0;
    QDateTime m_reconnectAt;
};

}
