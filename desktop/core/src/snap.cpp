#include "snap.h"

#include <QList>
#include <QTimeZone>

#include <cstdlib>
#include <utility>

namespace Tokkl
{

namespace
{
constexpr qint64 minuteMs = 60'000;

// a / b rounded down for a positive b. Integer division in C++ rounds towards
// zero instead.
qint64 floorDiv(qint64 a, qint64 b)
{
    const qint64 quotient = a / b;
    return a % b < 0 ? quotient - 1 : quotient;
}

// The last instant at or before time whose wall-clock time is a multiple of
// step at offset. All values are in milliseconds.
qint64 gridFloor(qint64 time, qint64 step, qint64 offset)
{
    return floorDiv(time + offset, step) * step - offset;
}

qint64 offsetAt(const QTimeZone &zone, qint64 time)
{
    return qint64(zone.offsetFromUtc(QDateTime::fromMSecsSinceEpoch(time, QTimeZone::UTC))) * 1000;
}

// The instant nearest time whose wall-clock time in zone is a multiple of
// step, taking the later one on a tie. Without an offset change within a step
// of time, the grid points on either side share the offset at time.
// Otherwise the candidates come from the offsets on both sides of the change,
// and each one counts only if it is on the grid with the offset in force at
// that instant, which also drops wall-clock times that a DST gap skips.
std::optional<qint64> nearestGridPoint(qint64 time, qint64 step, const QTimeZone &zone)
{
    QList<qint64> offsets;
    for (const qint64 at : {time - step, time, time + step}) {
        const qint64 offset = offsetAt(zone, at);
        if (!offsets.contains(offset)) {
            offsets.append(offset);
        }
    }
    if (offsets.size() == 1) {
        const qint64 below = gridFloor(time, step, offsets.first());
        return (time - below) * 2 >= step ? below + step : below;
    }
    std::optional<qint64> best;
    for (const qint64 offset : std::as_const(offsets)) {
        const qint64 below = gridFloor(time, step, offset);
        for (const qint64 candidate : {below - step, below, below + step, below + 2 * step}) {
            if (gridFloor(candidate, step, offsetAt(zone, candidate)) != candidate) {
                continue;
            }
            const qint64 nearer = best ? std::abs(candidate - time) - std::abs(*best - time) : -1;
            if (nearer < 0 || (nearer == 0 && candidate > *best)) {
                best = candidate;
            }
        }
    }
    return best;
}
}

bool isTimeResolution(qint64 minutes)
{
    return minutes >= 1 && 60 % minutes == 0;
}

std::optional<QDateTime> snapInstant(const QDateTime &at, int minutes, const QString &timeZone)
{
    if (!isTimeResolution(minutes) || !at.isValid()) {
        return std::nullopt;
    }
    const QTimeZone zone(timeZone.toUtf8());
    if (!zone.isValid()) {
        return std::nullopt;
    }
    const std::optional<qint64> point = nearestGridPoint(at.toMSecsSinceEpoch(), minutes * minuteMs, zone);
    if (!point) {
        return std::nullopt;
    }
    return QDateTime::fromMSecsSinceEpoch(*point, QTimeZone::UTC);
}

std::optional<std::optional<SnappedSpan>> snapSpan(const QDateTime &start, const QDateTime &stop, int minutes, const QString &timeZone)
{
    if (!isTimeResolution(minutes) || !start.isValid() || !stop.isValid()) {
        return std::nullopt;
    }
    const qint64 elapsed = start.msecsTo(stop);
    if (elapsed < 0) {
        return std::nullopt;
    }
    // A span too short to keep is dropped before the zone is looked up.
    if (elapsed * 2 < minutes * minuteMs) {
        return std::optional<SnappedSpan>();
    }
    const std::optional<QDateTime> snappedStart = snapInstant(start, minutes, timeZone);
    const std::optional<QDateTime> snappedStop = snapInstant(stop, minutes, timeZone);
    if (!snappedStart || !snappedStop) {
        return std::nullopt;
    }
    if (*snappedStop <= *snappedStart) {
        return std::optional<SnappedSpan>();
    }
    return std::optional<SnappedSpan>(SnappedSpan{*snappedStart, *snappedStop});
}

}
