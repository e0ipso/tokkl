#pragma once

#include <QDateTime>
#include <QString>

#include <optional>

namespace Tokkl
{

// Snapping a time entry to a resolution: the step, in minutes, of the clock
// grid that every stored start and stop lands on. The server snaps on write
// as well; the rules match packages/common/snap.ts.

struct SnappedSpan {
    QDateTime start;
    QDateTime stop;

    bool operator==(const SnappedSpan &other) const = default;
};

// True for the resolutions that divide an hour evenly: 1, 2, 3, 4, 5, 6, 10,
// 12, 15, 20, 30 and 60.
bool isTimeResolution(qint64 minutes);

// The grid point of a resolution of minutes nearest at on the wall clock of
// the IANA zone timeZone, the later one on a tie. nullopt for an invalid
// instant, resolution or zone.
std::optional<QDateTime> snapInstant(const QDateTime &at, int minutes, const QString &timeZone);

// Snaps the span from start to stop: each end moves to its nearest grid
// point, as snapInstant does, so two spans that meet still meet once snapped.
// Because the resolution divides an hour, the grid falls on every whole hour,
// also in zones 30 or 45 minutes off UTC, and near a DST change each grid
// point uses the offset in force at that point.
//
// The inner nullopt is a span too short to keep: it lasted less than half a
// step, or both ends snap to the same point. The outer nullopt is an invalid
// argument, including a stop before the start.
std::optional<std::optional<SnappedSpan>> snapSpan(const QDateTime &start, const QDateTime &stop, int minutes, const QString &timeZone);

}
