#include "clock.h"

namespace Tokkl
{

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

void SystemClock::schedule()
{
    // A few milliseconds past the boundary, so the new second has begun.
    const qint64 msec = QDateTime::currentMSecsSinceEpoch() % 1000;
    m_timer.start(int(1000 - msec + 5));
}

}
