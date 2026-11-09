#pragma once

#include <QDateTime>
#include <QObject>
#include <QTimer>

namespace Tokkl
{

// Wall-clock time, a once-per-second tick and the randomness of retry
// delays. Tests replace it with a clock they advance by hand and whose
// jitter they choose.
class Clock : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // The current time in UTC.
    virtual QDateTime now() const = 0;
    // A delay from 0 up to, but not including, boundMs, added to a retry so
    // that devices that lost the server at the same moment do not all come
    // back at the same moment. 0 when boundMs is not positive.
    virtual int jitterMs(int boundMs) const = 0;

Q_SIGNALS:
    // About once per second. Ticks are not counted: after a sleep the next
    // tick simply arrives late, and the receiver reads now() again.
    void ticked();
};

// The first wait of a retry, and the share of a wait a retry may add at
// random.
inline constexpr int retryMinMs = 1000;
inline constexpr int retryJitterDivisor = 4;

// The wait of a retry: baseMs plus up to a quarter of it more, at random, so
// that devices that lost the server at the same moment do not all come back
// at the same moment. The random part is the clock's jitter.
int retryWaitMs(int baseMs, const Clock &clock);

// The waits of one retry loop: the first is baseMs, each later one twice
// the one before up to capMs, and each takes retryWaitMs()'s jitter from the
// clock. reset() starts again at baseMs, as after a success.
class RetryBackoff
{
public:
    RetryBackoff(int baseMs, int capMs);

    // The wait before the next retry.
    int next(const Clock &clock);
    void reset();

private:
    int m_baseMs;
    int m_capMs;
    int m_nextMs;
};

// The system clock. Each tick is aimed just past the next whole second, so
// the timer does not drift away from the second boundary.
class SystemClock : public Clock
{
    Q_OBJECT

public:
    explicit SystemClock(QObject *parent = nullptr);

    QDateTime now() const override;
    // Uniformly random.
    int jitterMs(int boundMs) const override;

private:
    void schedule();

    QTimer m_timer;
};

}
