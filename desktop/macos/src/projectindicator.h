#pragma once

#include <QColor>
#include <QString>

namespace Tokkl
{

class TimerModel;

// The ring in the menu bar's text colour keeps the edge visible whatever the
// project colour. The slot keeps one size, so the elapsed time never moves.
struct ProjectIndicator {
    enum class Kind {
        Empty, // the project is still being read
        Outline, // no project
        Filled, // a known project
    };

    // In points.
    static constexpr int slotSize = 16;
    static constexpr int shapeSize = 10;
    static constexpr int squareRadius = 2;
    static constexpr int dashLength = 2;
    // Matches the web app's pulse.
    static constexpr int pulsePeriodMs = 1600;
    static constexpr double pulseMinimum = 0.35;

    Kind kind = Kind::Empty;
    bool round = false;
    // #rrggbb, or empty for the text colour.
    QString color;
    bool pulsing = false;
    QString label;

    bool operator==(const ProjectIndicator &other) const = default;

    static ProjectIndicator fromTimer(const TimerModel &timer, bool reduceMotion);

    static QColor inkColor(bool darkMenuBar);
    QColor fillColor(bool darkMenuBar) const;
    static double pulseOpacity(qint64 elapsedMs);
};

}
