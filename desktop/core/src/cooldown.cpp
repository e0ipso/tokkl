#include "cooldown.h"

#include "logging.h"

#include <algorithm>

namespace Tokkl
{

Cooldown::Cooldown(QObject *parent)
    : QObject(parent)
{
    m_timer.setSingleShot(true);
    connect(&m_timer, &QTimer::timeout, this, [this] {
        m_until = QDateTime();
        Q_EMIT ended();
    });
}

qint64 Cooldown::waitMs(const QByteArray &retryAfter)
{
    const QByteArray value = retryAfter.trimmed();
    qint64 ms = defaultMs;
    if (!value.isEmpty()) {
        bool isNumber = false;
        const qint64 seconds = value.toLongLong(&isNumber);
        if (isNumber) {
            ms = seconds * 1000;
        } else {
            const QDateTime when = QDateTime::fromString(QString::fromLatin1(value), Qt::RFC2822Date);
            if (when.isValid()) {
                ms = QDateTime::currentDateTimeUtc().msecsTo(when);
            }
        }
    }
    return std::clamp<qint64>(ms, minMs, maxMs);
}

void Cooldown::start(const QByteArray &retryAfter)
{
    const qint64 ms = waitMs(retryAfter);
    qCWarning(lcNet) << "Rate limited; waiting" << ms << "ms";
    m_until = QDateTime::currentDateTimeUtc().addMSecs(ms);
    m_timer.start(int(ms));
}

void Cooldown::clear()
{
    m_until = QDateTime();
    m_timer.stop();
}

bool Cooldown::active() const
{
    return m_until.isValid() && QDateTime::currentDateTimeUtc() < m_until;
}

QDateTime Cooldown::until() const
{
    return active() ? m_until : QDateTime();
}

}
