#include "cooldown.h"

#include "logging.h"

#include <algorithm>

namespace Tokkl
{

Cooldown::Cooldown(const Clock &clock, QObject *parent)
    : QObject(parent)
    , m_clock(clock)
{
    connect(&m_clock, &Clock::ticked, this, &Cooldown::onTick);
}

qint64 Cooldown::waitMs(const QByteArray &retryAfter, const QDateTime &now)
{
    const QByteArray value = retryAfter.trimmed();
    qint64 ms = defaultMs;
    if (!value.isEmpty()) {
        bool isNumber = false;
        const qint64 seconds = value.toLongLong(&isNumber);
        if (isNumber) {
            // Clamped in seconds first, so a huge value cannot overflow.
            ms = std::clamp<qint64>(seconds, minMs / 1000, maxMs / 1000) * 1000;
        } else {
            const QDateTime when = QDateTime::fromString(QString::fromLatin1(value), Qt::RFC2822Date);
            if (when.isValid()) {
                ms = now.msecsTo(when);
            }
        }
    }
    return std::clamp<qint64>(ms, minMs, maxMs);
}

void Cooldown::start(const QByteArray &retryAfter)
{
    const QDateTime now = m_clock.now();
    const qint64 ms = waitMs(retryAfter, now);
    qCWarning(lcNet) << "Rate limited; waiting" << ms << "ms";
    m_until = now.addMSecs(ms);
}

void Cooldown::clear()
{
    m_until = QDateTime();
}

bool Cooldown::active() const
{
    return m_until.isValid() && !over(m_clock.now());
}

bool Cooldown::over(const QDateTime &now) const
{
    return now >= m_until || now.msecsTo(m_until) > maxMs;
}

void Cooldown::onTick()
{
    if (m_until.isValid() && over(m_clock.now())) {
        m_until = QDateTime();
        Q_EMIT ended();
    }
}

QDateTime Cooldown::until() const
{
    return active() ? m_until : QDateTime();
}

}
