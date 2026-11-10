#pragma once

#include "clock.h"

#include <QByteArray>
#include <QDateTime>
#include <QObject>

namespace Tokkl
{

// Clamped to 1 s..1 h, so a bad or hostile Retry-After can neither block the
// app for hours nor make it retry in a loop.
class Cooldown : public QObject
{
    Q_OBJECT

public:
    static constexpr int defaultMs = 60000;
    static constexpr qint64 minMs = 1000;
    static constexpr qint64 maxMs = 3600 * 1000;

    // The clock must outlive the cooldown.
    explicit Cooldown(const Clock &clock, QObject *parent = nullptr);

    static qint64 waitMs(const QByteArray &retryAfter, const QDateTime &now);

    void start(const QByteArray &retryAfter);
    // Ends the wait without emitting ended().
    void clear();
    bool active() const;
    // Invalid while none runs.
    QDateTime until() const;

Q_SIGNALS:
    void ended();

private:
    bool over(const QDateTime &now) const;
    void onTick();

    const Clock &m_clock;
    QDateTime m_until;
};

}
