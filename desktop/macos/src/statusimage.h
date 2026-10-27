#pragma once

#include "projectindicator.h"

#include <QImage>
#include <QList>
#include <QRect>
#include <QSize>

namespace Tokkl
{

// The menu bar item's image, drawn before the elapsed time. It holds the
// Tokkl clock logo, then the project indicator, then in Pomodoro mode the
// hourglass. This decides the parts, their order and their places, in points
// from the image's top left corner. The platform draws each part in its
// place.
//
// The logo is the app icon at 16 points, the 1x and 2x files npm run icons
// renders into resources/Tokkl.iconset, compiled into the library. Monochrome
// mode swaps it for the outline logo in resources/mono_16x16*.png, and the
// hourglass for resources/hourglass_mono_16x16*.png, and tints both with the
// menu bar foreground; the indicator keeps its colours. Within a mode the
// image has the same size in every state, so the time never moves.
struct StatusImage {
    // The logo's side, as tall as the indicator slot and a menu bar icon.
    static constexpr int logoSize = ProjectIndicator::slotSize;
    // The space between the logo and the indicator slot, and between the
    // slot and the hourglass.
    static constexpr int spacing = 2;

    // The logo at 1x and 2x, the outline when monochromeLogo is set. Each
    // image has its device pixel ratio set, so each is logoSize points square.
    QList<QImage> logo;
    // Tints the logo and the hourglass with the menu bar foreground.
    bool monochromeLogo = false;
    QRect logoRect;
    ProjectIndicator indicator;
    QRect indicatorRect;
    // The hourglass at 1x and 2x in Pomodoro mode, like the logo; empty, with
    // a null rect, in Timer mode.
    QList<QImage> hourglass;
    QRect hourglassRect;
    QSize size;

    bool operator==(const StatusImage &other) const = default;

    // The logo followed by the indicator, and by the hourglass in Pomodoro
    // mode.
    static StatusImage compose(const ProjectIndicator &indicator, bool monochromeLogo = false, bool pomodoroMode = false);
    // The logo's images, full colour or outline, read from the library's
    // resources once.
    static const QList<QImage> &logoImages(bool monochrome = false);
    // The hourglass's images, full colour or outline, read once.
    static const QList<QImage> &hourglassImages(bool monochrome = false);
};

}
