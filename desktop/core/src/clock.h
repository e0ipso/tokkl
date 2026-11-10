#pragma once

#include <QDateTime>
#include <QObject>
#include <QTimer>

namespace Tokkl
{

// Tests replace it with a clock they advance by hand.
class Clock : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // UTC.
    virtual QDateTime now() const = 0;
    // In [0, boundMs), so devices that lost the server together do not all come
    // back together. 0 when boundMs is not positive.
    virtual int jitterMs(int boundMs) const = 0;

Q_SIGNALS:
    // About once per second. Ticks are not counted: after a sleep the next one
    // arrives late, and the receiver reads now() again.
    void ticked();
};

inline constexpr int retryMinMs = 1000;
inline constexpr int retryJitterDivisor = 4;

// baseMs plus up to a quarter more from the clock's jitter.
int retryWaitMs(int baseMs, const Clock &clock);

// Doubles from baseMs up to capMs; reset() starts again, as after a success.
class RetryBackoff
{
public:
    RetryBackoff(int baseMs, int capMs);

    int next(const Clock &clock);
    void reset();

private:
    int m_baseMs;
    int m_capMs;
    int m_nextMs;
};

// Each tick aims just past the next whole second, so it does not drift.
class SystemClock : public Clock
{
    Q_OBJECT

public:
    explicit SystemClock(QObject *parent = nullptr);

    QDateTime now() const override;
    int jitterMs(int boundMs) const override;

private:
    void schedule();

    QTimer m_timer;
};

}
