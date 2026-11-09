#include "timerstateclient.h"

#include "clock.h"
#include "logging.h"
#include "transport.h"

#include <algorithm>
#include <utility>

namespace Tokkl
{

TimerStateClient::TimerStateClient(Connection *connection, Clock *clock, QObject *parent)
    : SessionState(parent)
    , m_connection(connection)
    , m_clock(clock)
{
    if (m_connection) {
        m_generation = m_connection->generation();
        connect(m_connection, &Connection::stateChanged, this, &TimerStateClient::onConnectionStateChanged);
        // A bind to another account under the same state sends only this.
        connect(m_connection, &Connection::accountChanged, this, &TimerStateClient::onConnectionStateChanged);
        connect(m_connection, &Connection::generationChanged, this, &TimerStateClient::onGenerationChanged);
    }
    if (m_clock) {
        connect(m_clock, &Clock::ticked, this, &TimerStateClient::onTick);
    }
    onConnectionStateChanged();
}

TimerStateClient::~TimerStateClient()
{
    if (m_stream) {
        disconnect(m_stream, nullptr, this, nullptr);
        m_stream->abort();
    }
}

Connection *TimerStateClient::connection() const
{
    return m_connection;
}

Clock *TimerStateClient::clock() const
{
    return m_clock;
}

const std::optional<TimerState> &TimerStateClient::state() const
{
    return m_state;
}

bool TimerStateClient::streaming() const
{
    return m_streaming;
}

bool TimerStateClient::settling() const
{
    return m_settling;
}

qint64 TimerStateClient::serverOffsetMs() const
{
    return m_offsetMs;
}

QDateTime TimerStateClient::serverNow() const
{
    const QDateTime now = m_clock ? m_clock->now() : QDateTime::currentDateTimeUtc();
    return now.addMSecs(m_offsetMs);
}

// ----- reading the state ---------------------------------------------------

bool TimerStateClient::readable() const
{
    return m_connection && m_connection->isConnected() && !m_connection->rateLimitedUntil().isValid();
}

void TimerStateClient::refresh()
{
    requestRead(true);
}

void TimerStateClient::requestRead(bool fresh)
{
    if (!readable()) {
        return;
    }
    if (m_reading) {
        m_readAgain = m_readAgain || fresh;
        return;
    }
    m_reading = true;
    m_readAgain = false;
    if (m_clock) {
        m_nextPoll = m_clock->now().addMSecs(pollIntervalMs);
    }
    QPointer<TimerStateClient> self(this);
    const quint64 generation = m_generation;
    const quint64 serial = ++m_readsSent;
    m_connection->fetchTimerState([self, generation, serial](const ApiResult<TimerState> &result) {
        if (!self || generation != self->m_generation) {
            return;
        }
        self->m_reading = false;
        // Sent after the outcome, so it shows what the server did. The
        // state held may be newer still, from the stream.
        const bool settled = result.ok() && self->m_settling && serial > self->m_settleAfter;
        if (settled) {
            self->m_settling = false;
        }
        if (result.ok()) {
            self->adopt(*result.value);
        }
        if (settled) {
            Q_EMIT self->settlingChanged();
        }
        if (std::exchange(self->m_readAgain, false)) {
            self->requestRead(false);
        }
    });
}

void TimerStateClient::settle()
{
    m_settleAfter = m_readsSent;
    setSettling(true);
    requestRead(true);
}

void TimerStateClient::setSettling(bool settling)
{
    if (settling == m_settling) {
        return;
    }
    m_settling = settling;
    Q_EMIT settlingChanged();
}

bool TimerStateClient::adopt(const TimerState &state)
{
    // Within a generation the revision only goes up; an older state was
    // overtaken by the one held.
    if (m_state && state.revision < m_state->revision) {
        return false;
    }
    m_state = state;
    setOffset(m_clock ? m_clock->now().msecsTo(state.serverTime) : 0);
    Q_EMIT stateChanged();
    return true;
}

void TimerStateClient::setOffset(qint64 offsetMs)
{
    if (offsetMs == m_offsetMs) {
        return;
    }
    m_offsetMs = offsetMs;
    Q_EMIT offsetChanged();
}

// ----- connection and clock ------------------------------------------------

void TimerStateClient::onConnectionStateChanged()
{
    if (!m_connection) {
        return;
    }
    const Connection::State state = m_connection->state();
    const bool up = m_connection->isConnected() && state == Connection::Connected;
    // A new account, or back from a connectivity failure or a cooldown.
    const bool cameUp = up && (!m_started || m_lastState != Connection::Connected);
    m_lastState = state;
    if (!cameUp) {
        return;
    }
    m_started = true;
    requestRead(false);
    if (!m_stream) {
        openStream();
    }
}

void TimerStateClient::onGenerationChanged()
{
    m_generation = m_connection ? m_connection->generation() : 0;
    closeStream();
    m_reconnectAt = QDateTime();
    m_backoffMs = reconnectMinMs;
    m_retryFloorMs = 0;
    m_reading = false;
    m_readAgain = false;
    m_nextPoll = QDateTime();
    m_started = false;
    setOffset(0);
    // The write belonged to the earlier account.
    setSettling(false);
    if (m_state) {
        m_state.reset();
        Q_EMIT stateChanged();
    }
    Q_EMIT accountReset();
}

void TimerStateClient::resumed()
{
    refresh();
    if (!m_connection || !m_connection->isConnected()) {
        return;
    }
    // A stream from before the sleep may be dead without knowing it yet.
    closeStream();
    openStream();
}

void TimerStateClient::onTick()
{
    if (!m_clock) {
        return;
    }
    const QDateTime now = m_clock->now();
    const qint64 gap = m_lastTick.isValid() ? m_lastTick.msecsTo(now) : 0;
    m_lastTick = now;
    if (gap > resumeGapMs || gap < -resumeGapMs) {
        resumed();
        return;
    }
    // A clock set back would otherwise postpone the reconnect or the poll.
    if (m_reconnectAt.isValid() && (now >= m_reconnectAt || now.msecsTo(m_reconnectAt) > reconnectLongestMs)) {
        openStream();
    }
    if ((!m_streaming || m_settling) && (!m_nextPoll.isValid() || now >= m_nextPoll || now.msecsTo(m_nextPoll) > pollIntervalMs)) {
        requestRead(false);
    }
}

// ----- the event stream ----------------------------------------------------

void TimerStateClient::openStream()
{
    m_reconnectAt = QDateTime();
    if (!m_connection || !m_connection->isConnected()) {
        return;
    }
    PendingStream *stream = m_connection->openTimerEvents();
    if (!stream) {
        scheduleReconnect(); // a cooldown
        return;
    }
    ++m_streamSerial;
    m_stream = stream;
    m_buffer.clear();
    m_event = PendingEvent();
    connect(stream, &PendingStream::dataReceived, this, &TimerStateClient::onStreamData);
    connect(stream, &PendingStream::finished, this, &TimerStateClient::onStreamEnded);
}

void TimerStateClient::closeStream()
{
    ++m_streamSerial;
    if (m_stream) {
        disconnect(m_stream, nullptr, this, nullptr);
        m_stream->abort();
    }
    m_stream = nullptr;
    m_buffer.clear();
    m_event = PendingEvent();
    setStreaming(false);
}

void TimerStateClient::scheduleReconnect()
{
    if (!m_clock) {
        return;
    }
    const int baseMs = std::max(m_backoffMs, m_retryFloorMs);
    const int waitMs = retryWaitMs(baseMs, m_clock);
    m_reconnectAt = m_clock->now().addMSecs(waitMs);
    qCDebug(lcNet) << "Event stream reconnects in" << waitMs << "ms";
    m_backoffMs = std::min(m_backoffMs * 2, reconnectMaxMs);
}

void TimerStateClient::onStreamEnded()
{
    // The connection refused the credentials, or the stream belongs to an
    // earlier generation.
    if (!m_connection || m_connection->generation() != m_generation) {
        return;
    }
    const bool delivered = m_streaming;
    if (delivered && m_clock && m_streamingSince.isValid() && m_streamingSince.msecsTo(m_clock->now()) >= reconnectMaxMs) {
        m_backoffMs = reconnectMinMs;
    }
    ++m_streamSerial;
    m_stream = nullptr;
    m_buffer.clear();
    m_event = PendingEvent();
    setStreaming(false);
    if (delivered) {
        // The state may have changed after the last event.
        refresh();
    }
    scheduleReconnect();
}

void TimerStateClient::onStreamData(const QByteArray &data)
{
    // Handlers of the states read here may close or replace the stream, so
    // the lines are read from a copy, and only while the stream stays.
    const quint64 serial = m_streamSerial;
    QByteArray buffer = std::exchange(m_buffer, QByteArray()) + data;
    qsizetype start = 0;
    for (qsizetype end = buffer.indexOf('\n'); end >= 0 && serial == m_streamSerial; end = buffer.indexOf('\n', start)) {
        // Counted before the line is read, so an event over the limit never
        // reaches the parser, even when it arrives whole.
        m_event.bytes += end + 1 - start;
        if (m_event.bytes > maxEventBytes) {
            dropOversizedStream();
            return;
        }
        QByteArrayView line(buffer.constData() + start, end - start);
        if (line.endsWith('\r')) {
            line.chop(1);
        }
        start = end + 1;
        readLine(line);
    }
    if (serial != m_streamSerial) {
        return;
    }
    m_buffer = buffer.mid(start);
    if (m_event.bytes + m_buffer.size() > maxEventBytes) {
        dropOversizedStream();
    }
}

void TimerStateClient::dropOversizedStream()
{
    // Not a stream of timer states.
    qCWarning(lcNet) << "Event stream sent more than" << maxEventBytes << "bytes for one event; dropped";
    closeStream();
    scheduleReconnect();
}

void TimerStateClient::dropUnreadableStream()
{
    // Its keep-alives would hold it open, and the states after this one may
    // be just as unreadable. The state comes from a read until another
    // stream delivers.
    qCWarning(lcNet) << "Event stream sent a timer event Tokkl could not read; dropped";
    closeStream();
    refresh();
    scheduleReconnect();
}

void TimerStateClient::readLine(QByteArrayView line)
{
    if (line.isEmpty()) {
        dispatchEvent();
        return;
    }
    if (line.startsWith(':')) {
        return; // a comment
    }
    const qsizetype colon = line.indexOf(':');
    const QByteArrayView field = colon < 0 ? line : line.first(colon);
    QByteArrayView value = colon < 0 ? QByteArrayView() : line.sliced(colon + 1);
    if (value.startsWith(' ')) {
        value = value.sliced(1);
    }
    if (field == "event") {
        m_event.type = value.toByteArray();
    } else if (field == "data") {
        if (m_event.hasData) {
            m_event.data += '\n';
        }
        m_event.data += value;
        m_event.hasData = true;
    } else if (field == "retry") {
        readRetry(value);
    }
    // id and any other field are not used.
}

void TimerStateClient::readRetry(QByteArrayView value)
{
    // ASCII digits only, as the event stream format says; anything else is
    // ignored. A longer wait than the cap means the cap.
    if (value.isEmpty() || value.size() > 9 || !std::all_of(value.begin(), value.end(), [](char c) {
            return c >= '0' && c <= '9';
        })) {
        return;
    }
    m_retryFloorMs = std::min(int(value.toInt()), reconnectMaxMs);
}

void TimerStateClient::dispatchEvent()
{
    const PendingEvent event = std::exchange(m_event, PendingEvent());
    if (!event.hasData || event.type != "timer") {
        return;
    }
    const std::optional<QJsonValue> json = parseJsonBody(event.data);
    const std::optional<TimerState> state = json ? decodeTimerState(*json) : std::nullopt;
    if (!state) {
        dropUnreadableStream();
        return;
    }
    setStreaming(true);
    adopt(*state);
}

void TimerStateClient::setStreaming(bool streaming)
{
    if (streaming == m_streaming) {
        return;
    }
    m_streaming = streaming;
    m_streamingSince = streaming && m_clock ? m_clock->now() : QDateTime();
    Q_EMIT streamingChanged();
}

// ----- actions -------------------------------------------------------------

TimerStateClient::ActionCallback TimerStateClient::adopting(ActionCallback done)
{
    QPointer<TimerStateClient> self(this);
    return [self, done](const TimerActionResult &result) {
        if (self) {
            if (result.state) {
                self->adopt(*result.state);
            } else if (result.outcome == TimerActionResult::Outcome::Unknown) {
                qCInfo(lcTimer) << "Timer action outcome unknown; settling by reads:" << result.error.message;
                // Settled by what the server holds, never by sending again.
                self->settle();
            }
        }
        if (done) {
            done(result);
        }
    };
}

void TimerStateClient::refuseLater(const ActionCallback &done, const QString &message)
{
    if (!done) {
        return;
    }
    ApiError error;
    error.kind = ApiError::Kind::NotConnected;
    error.message = message;
    const TimerActionResult result{TimerActionResult::Outcome::Refused, std::nullopt, error};
    QMetaObject::invokeMethod(
        this,
        [done, result] {
            done(result);
        },
        Qt::QueuedConnection);
}

void TimerStateClient::withRevision(const std::function<void(Connection &, qint64, ActionCallback)> &action, ActionCallback done)
{
    if (!m_connection) {
        refuseLater(done, tr("Not connected to a Tokkl account."));
        return;
    }
    if (!m_state) {
        refuseLater(done, tr("The timer has not been read yet."));
        return;
    }
    action(*m_connection, m_state->revision, adopting(std::move(done)));
}

void TimerStateClient::start(const StartEntry &entry, ActionCallback done)
{
    withRevision(
        [entry](Connection &connection, qint64 revision, ActionCallback adopted) {
            connection.startTimer(revision, entry, std::move(adopted));
        },
        std::move(done));
}

void TimerStateClient::stop(ActionCallback done)
{
    withRevision(&Connection::stopTimer, std::move(done));
}

void TimerStateClient::pause(ActionCallback done)
{
    withRevision(&Connection::pauseTimer, std::move(done));
}

void TimerStateClient::resume(ActionCallback done)
{
    withRevision(&Connection::resumeTimer, std::move(done));
}

void TimerStateClient::discard(ActionCallback done)
{
    withRevision(&Connection::discardPause, std::move(done));
}

void TimerStateClient::edit(qint64 entryId, const TimeEntryUpdate &update, ActionCallback done)
{
    if (!m_connection) {
        refuseLater(done, tr("Not connected to a Tokkl account."));
        return;
    }
    m_connection->editTimer(entryId, update, adopting(std::move(done)));
}

void TimerStateClient::startPomodoro(const PomodoroStart &start, ActionCallback done)
{
    withRevision(
        [start](Connection &connection, qint64 revision, ActionCallback adopted) {
            connection.startPomodoro(revision, start, std::move(adopted));
        },
        std::move(done));
}

void TimerStateClient::nextPhase(ActionCallback done)
{
    withRevision(&Connection::nextPomodoroPhase, std::move(done));
}

void TimerStateClient::endPomodoro(ActionCallback done)
{
    withRevision(&Connection::endPomodoro, std::move(done));
}

}
