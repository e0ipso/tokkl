#pragma once

#include "apitypes.h"

#include <optional>

namespace Tokkl
{

// The timer state a controller shows: the state client's latest, or the
// reply of a v9 write on top of an older one. A patched state stays until a
// state with a newer revision comes, so a read that was answered before the
// write cannot undo it.
class TimerView
{
public:
    // What the panel shows of the state for one workspace.
    struct Shown {
        std::optional<TimeEntry> entry; // the running entry, outside a session
        std::optional<TimerPause> chain; // paused, or with entry as its clone
        bool session = false; // a Pomodoro session runs; its pomodoro is not entry
    };

    const std::optional<TimerState> &state() const;

    // Takes the client's state, unless a patched one is as new or newer.
    // Returns whether it was taken.
    bool adopt(const TimerState &state);
    // Forgets the state, as for a new generation.
    void clear();
    // Puts running on the state held as the reply of a write sent at
    // revision, and ends the chain and the session it leaves no place for,
    // as the server settles them. False, and nothing changes, without a
    // state or when a newer state has come since.
    bool patch(qint64 revision, const std::optional<TimeEntry> &running);

    // The entry, chain and session of the state for the workspace. A hidden
    // workspace, one Tokkl lost access to, shows nothing that runs in it.
    // An entry or chain of another workspace is not shown either.
    Shown shown(qint64 workspaceId, bool hidden) const;

    // Whether the panel would show a change between the two chains: paused,
    // seconds, clone, project and billable flag.
    static bool sameChain(const std::optional<TimerPause> &a, const std::optional<TimerPause> &b);

private:
    std::optional<TimerState> m_state;
    bool m_patched = false;
};

}
