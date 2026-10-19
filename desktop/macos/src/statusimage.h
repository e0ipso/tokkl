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
// renders into resources/Tokkl.iconset, compiled into the library. It keeps
// its own colours, so the platform must not draw it as a template image.
// The image has the same size in every state, so the time never moves.
struct StatusImage {
    // The logo's side, as tall as the indicator slot and a menu bar icon.
    static constexpr int logoSize = ProjectIndicator::slotSize;
    // The space between the logo and the indicator slot.
    static constexpr int spacing = 2;

    // The logo at 1x and 2x. Each image has its device pixel ratio set, so
    // each is logoSize points square.
    QList<QImage> logo;
    QRect logoRect;
    ProjectIndicator indicator;
    QRect indicatorRect;
    QSize size;

    bool operator==(const StatusImage &other) const = default;

    // The logo followed by the indicator.
    static StatusImage compose(const ProjectIndicator &indicator);
    // The logo's images, read from the library's resources once.
    static const QList<QImage> &logoImages();
};

}
