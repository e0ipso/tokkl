#pragma once

#include <QByteArray>
#include <QDateTime>
#include <QObject>
#include <QTimer>

namespace Tokkl
{

// The wait a 429, or a 503 with Retry-After, asks for. Retry-After gives it
// as delta seconds or an HTTP date; without the header it is defaultMs. Any value is clamped to 1 s to
// 1 h, so a bad or hostile header can neither block the app for hours nor
// make it retry in a loop.
class Cooldown : public QObject
{
    Q_OBJECT

public:
    static constexpr int defaultMs = 60000;
    static constexpr qint64 minMs = 1000;
    static constexpr qint64 maxMs = 3600 * 1000;

    explicit Cooldown(QObject *parent = nullptr);

    // The wait for a Retry-After header value, clamped.
    static qint64 waitMs(const QByteArray &retryAfter);

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
    QDateTime m_until;
    QTimer m_timer;
};

}
