#pragma once

#include "projectindicator.h"

#include <QImage>
#include <QList>
#include <QRect>
#include <QSize>

namespace Tokkl
{

// The menu bar item's image, drawn before the elapsed time. It holds the
// Tokkl clock logo, then the project indicator. This decides the parts, their
// order and their places, in points from the image's top left corner. The
// platform draws each part in its place.
//
// The logo is the app icon at 16 points, the 1x and 2x files npm run icons
// renders into resources/Tokkl.iconset, compiled into the library. Monochrome
// mode swaps it for the outline logo in resources/mono_16x16*.png and tints
// only the logo with the menu bar foreground; the indicator keeps its colours.
// The image has the same size in every state, so the time never moves.
struct StatusImage {
    // The logo's side, as tall as the indicator slot and a menu bar icon.
    static constexpr int logoSize = ProjectIndicator::slotSize;
    // The space between the logo and the indicator slot.
    static constexpr int spacing = 2;

    // The logo at 1x and 2x, the outline when monochromeLogo is set. Each
    // image has its device pixel ratio set, so each is logoSize points square.
    QList<QImage> logo;
    bool monochromeLogo = false;
    QRect logoRect;
    ProjectIndicator indicator;
    QRect indicatorRect;
    QSize size;

    bool operator==(const StatusImage &other) const = default;

    // The logo followed by the indicator.
    static StatusImage compose(const ProjectIndicator &indicator, bool monochromeLogo = false);
    // The logo's images, full colour or outline, read from the library's
    // resources once.
    static const QList<QImage> &logoImages(bool monochrome = false);
};

}
