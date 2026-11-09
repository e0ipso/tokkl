#pragma once

#include "clock.h"

#include <QByteArray>
#include <QDateTime>
#include <QObject>

namespace Tokkl
{

// The wait a 429, or a 503 with Retry-After, asks for. Retry-After gives it
// as delta seconds or an HTTP date; without the header it is defaultMs. Any value is clamped to 1 s to
// 1 h, so a bad or hostile header can neither block the app for hours nor
// make it retry in a loop.
//
// The wait runs on the clock given: it ends on the first tick at or after
// its end, also after a sleep, and at once when the clock was set back so
// far that more than the longest wait remains.
class Cooldown : public QObject
{
    Q_OBJECT

public:
    static constexpr int defaultMs = 60000;
    static constexpr qint64 minMs = 1000;
    static constexpr qint64 maxMs = 3600 * 1000;

    // The clock is not owned and must outlive the cooldown.
    explicit Cooldown(const Clock &clock, QObject *parent = nullptr);

    // The wait for a Retry-After header value at now, clamped.
    static qint64 waitMs(const QByteArray &retryAfter, const QDateTime &now);

    // Starts the wait the header asks for, replacing one that runs.
    void start(const QByteArray &retryAfter);
    // Ends the wait without emitting ended().
    void clear();
    bool active() const;
    // When the wait ends; invalid while none runs.
    QDateTime until() const;

Q_SIGNALS:
    // The wait ran out.
    void ended();

private:
    // Whether the wait that ends at m_until is over at now.
    bool over(const QDateTime &now) const;
    void onTick();

    const Clock &m_clock;
    QDateTime m_until;
};

}
