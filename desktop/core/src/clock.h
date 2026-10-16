#pragma once

#include <QDateTime>
#include <QObject>
#include <QTimer>

namespace Tokkl
{

// Wall-clock time and a once-per-second tick. Tests replace it with a clock
// they advance by hand.
class Clock : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // The current time in UTC.
    virtual QDateTime now() const = 0;

Q_SIGNALS:
    // About once per second. Ticks are not counted: after a sleep the next
    // tick simply arrives late, and the receiver reads now() again.
    void ticked();
};

// The system clock. Each tick is aimed just past the next whole second, so
// the timer does not drift away from the second boundary.
class SystemClock : public Clock
{
    Q_OBJECT

public:
    explicit SystemClock(QObject *parent = nullptr);

    QDateTime now() const override;

private:
    void schedule();

    QTimer m_timer;
};

}
