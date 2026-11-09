#include "clock.h"

#include <QRandomGenerator>

#include <algorithm>

namespace Tokkl
{

namespace
{
int randomBelow(int boundMs)
{
    return boundMs > 0 ? int(QRandomGenerator::global()->bounded(boundMs)) : 0;
}
}

int retryWaitMs(int baseMs, const Clock *clock)
{
    const int boundMs = baseMs / retryJitterDivisor;
    return baseMs + (clock ? clock->jitterMs(boundMs) : randomBelow(boundMs));
}

RetryBackoff::RetryBackoff(int baseMs, int capMs)
    : m_baseMs(baseMs)
    , m_capMs(capMs)
    , m_nextMs(baseMs)
{
}

int RetryBackoff::next(const Clock *clock)
{
    const int waitMs = retryWaitMs(m_nextMs, clock);
    m_nextMs = std::min(m_nextMs * 2, m_capMs);
    return waitMs;
}

void RetryBackoff::reset()
{
    m_nextMs = m_baseMs;
}

SystemClock::SystemClock(QObject *parent)
    : Clock(parent)
{
    m_timer.setSingleShot(true);
    m_timer.setTimerType(Qt::PreciseTimer);
    connect(&m_timer, &QTimer::timeout, this, [this] {
        schedule();
        Q_EMIT ticked();
    });
    schedule();
}

QDateTime SystemClock::now() const
{
    return QDateTime::currentDateTimeUtc();
}

int SystemClock::jitterMs(int boundMs) const
{
    return randomBelow(boundMs);
}

void SystemClock::schedule()
{
    // A few milliseconds past the boundary, so the new second has begun.
    const qint64 msec = QDateTime::currentMSecsSinceEpoch() % 1000;
    m_timer.start(int(1000 - msec + 5));
}

}
