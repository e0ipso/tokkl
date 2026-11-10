#pragma once

#include "apitypes.h"

#include <optional>

namespace Tokkl
{

// Derived only from the state the TimerStateClient accepted.
struct TimerView {
    std::optional<TimeEntry> entry; // the running entry, outside a session
    std::optional<TimerPause> chain; // paused, or with entry as its clone
    bool session = false; // a Pomodoro session runs; its pomodoro is not entry

    // Shows nothing for a hidden (lost) workspace, for another workspace, or for
    // a chain whose clone is not the running entry.
    static TimerView of(const std::optional<TimerState> &state, qint64 workspaceId, bool hidden);

    bool paused() const;

    // Compares what the panel shows: paused, seconds, clone, project, billable.
    static bool sameChain(const std::optional<TimerPause> &a, const std::optional<TimerPause> &b);
};

}
