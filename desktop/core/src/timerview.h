#pragma once

#include "apitypes.h"

#include <optional>

namespace Tokkl
{

// What a panel shows of one timer state for one workspace: the running
// entry, the pause chain and whether a Pomodoro session holds the timer.
// It is derived from the state the TimerStateClient accepted and from
// nothing else.
struct TimerView {
    std::optional<TimeEntry> entry; // the running entry, outside a session
    std::optional<TimerPause> chain; // paused, or with entry as its clone
    bool session = false; // a Pomodoro session runs; its pomodoro is not entry

    // The view of state. A hidden workspace, one Tokkl lost access to,
    // shows nothing that runs in it. An entry or chain of another workspace
    // is not shown either, and neither is a chain whose clone is not the
    // running entry.
    static TimerView of(const std::optional<TimerState> &state, qint64 workspaceId, bool hidden);

    bool paused() const;

    // Whether the panel would show a change between the two chains: paused,
    // seconds, clone, project and billable flag.
    static bool sameChain(const std::optional<TimerPause> &a, const std::optional<TimerPause> &b);
};

}
