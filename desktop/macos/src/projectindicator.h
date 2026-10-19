#pragma once

#include <QColor>
#include <QString>

namespace Tokkl
{

class TimerController;

// The project indicator next to the elapsed time in the menu bar, as the KDE
// panel draws it. It shows the core's chosenProjectId: the running or paused
// entry's project, or the next start's while stopped. The app adds no rule of
// its own; this decides what to draw and the platform draws it.
//
// A dot while an entry runs and a still square while paused or stopped. The
// project colour fills the shape inside a ring in the menu bar's text colour,
// which keeps the edge visible on light and dark menu bars whatever the
// project colour. A project without a valid colour is filled with the text
// colour.
// No project draws a dashed outline of the shape, and a project still being
// read leaves the slot empty. The slot has the same size in every state, so
// the elapsed time never moves.
//
// Only the running dot's fill pulses, and not under reduced motion. The ring
// and the outline never fade. The label names the project, so the shape is
// never the only signal.
struct ProjectIndicator {
    enum class Kind {
        Empty, // the project is still being read
        Outline, // no project
        Filled, // a known project
    };

    // The slot, the shape inside it, the corner of the square and the dash
    // of the outline, in points.
    static constexpr int slotSize = 16;
    static constexpr int shapeSize = 10;
    static constexpr int squareRadius = 2;
    static constexpr int dashLength = 2;
    // One pulse of the fill, from full opacity down to pulseMinimum and back,
    // as in the web app.
    static constexpr int pulsePeriodMs = 1600;
    static constexpr double pulseMinimum = 0.35;

    Kind kind = Kind::Empty;
    // A dot while the timer runs, a square while it is paused or stopped.
    bool round = false;
    // The project colour as #rrggbb, or empty for the text colour.
    QString color;
    bool pulsing = false;
    // The project's name, "No project" or "Unknown project".
    QString label;

    bool operator==(const ProjectIndicator &other) const = default;

    // What to draw for the timer. reduceMotion is the system's Reduce Motion
    // setting.
    static ProjectIndicator fromTimer(const TimerController &timer, bool reduceMotion);

    // The ring and outline colour: the menu bar's own text colour, black on
    // a light menu bar and white on a dark one.
    static QColor inkColor(bool darkMenuBar);
    // The fill: the project colour, or the ink without one.
    QColor fillColor(bool darkMenuBar) const;
    // The fill's opacity elapsedMs into the pulse: 1 at the start of each
    // period, pulseMinimum half way, on a sine curve.
    static double pulseOpacity(qint64 elapsedMs);
};

}
