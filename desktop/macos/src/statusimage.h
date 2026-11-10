#pragma once

#include "projectindicator.h"

#include <QImage>
#include <QList>
#include <QRect>
#include <QSize>

namespace Tokkl
{

// Rects are in points from the top left. Within a mode the image keeps one
// size, so the time never moves.
struct StatusImage {
    static constexpr int logoSize = ProjectIndicator::slotSize;
    static constexpr int spacing = 2;

    // 1x and 2x, each with its device pixel ratio set.
    QList<QImage> logo;
    bool monochromeLogo = false;
    QRect logoRect;
    ProjectIndicator indicator;
    QRect indicatorRect;
    // Empty, with a null rect, in Timer mode.
    QList<QImage> hourglass;
    QRect hourglassRect;
    QSize size;

    bool operator==(const StatusImage &other) const = default;

    static StatusImage compose(const ProjectIndicator &indicator, bool monochromeLogo = false, bool pomodoroMode = false);
    static const QList<QImage> &logoImages(bool monochrome = false);
    static const QList<QImage> &hourglassImages(bool monochrome = false);
};

}
