#include "timerview.h"

namespace Tokkl
{

TimerView TimerView::of(const std::optional<TimerState> &state, qint64 workspaceId, bool hidden)
{
    TimerView view;
    view.session = state && state->pomodoro;
    // The session's pomodoro is the session's.
    if (!state || hidden || view.session) {
        return view;
    }
    view.entry = state->runningEntry;
    if (view.entry && view.entry->workspaceId != workspaceId) {
        view.entry.reset();
    }
    view.chain = state->pause;
    if (view.chain && (view.chain->workspaceId != workspaceId || !(view.entry ? view.chain->cloneEntryId == view.entry->id : view.chain->paused))) {
        view.chain.reset();
    }
    return view;
}

bool TimerView::paused() const
{
    return chain && chain->paused;
}

bool TimerView::sameChain(const std::optional<TimerPause> &a, const std::optional<TimerPause> &b)
{
    if (a.has_value() != b.has_value()) {
        return false;
    }
    return !a
        || (a->paused == b->paused && a->seconds == b->seconds && a->cloneEntryId == b->cloneEntryId && a->projectId == b->projectId
            && a->billable == b->billable);
}

}
