#include "projectindicator.h"

#include "statuswords.h"
#include "timercontroller.h"

#include <cmath>
#include <numbers>

namespace Tokkl
{

ProjectIndicator ProjectIndicator::fromTimer(const TimerController &timer, bool reduceMotion)
{
    ProjectIndicator indicator;
    switch (timer.indicatorState()) {
    case TimerController::IndicatorState::Pending:
        indicator.kind = Kind::Empty;
        break;
    case TimerController::IndicatorState::None:
        indicator.kind = Kind::Outline;
        break;
    case TimerController::IndicatorState::Project:
        indicator.kind = Kind::Filled;
        indicator.color = timer.indicatorColor();
        break;
    }
    indicator.round = timer.isRunning();
    indicator.pulsing = indicator.kind == Kind::Filled && indicator.round && !reduceMotion;
    indicator.label = StatusWords::projectText(timer);
    return indicator;
}

QColor ProjectIndicator::inkColor(bool darkMenuBar)
{
    return darkMenuBar ? QColor(Qt::white) : QColor(Qt::black);
}

QColor ProjectIndicator::fillColor(bool darkMenuBar) const
{
    const QColor project = QColor::fromString(color);
    return project.isValid() ? project : inkColor(darkMenuBar);
}

double ProjectIndicator::pulseOpacity(qint64 elapsedMs)
{
    const double phase = double(elapsedMs % pulsePeriodMs) / pulsePeriodMs;
    return pulseMinimum + (1.0 - pulseMinimum) * (1.0 + std::cos(2.0 * std::numbers::pi * phase)) / 2.0;
}

}
