#include "timerview.h"

namespace Tokkl
{

const std::optional<TimerState> &TimerView::state() const
{
    return m_state;
}

bool TimerView::adopt(const TimerState &state)
{
    if (m_state && m_patched && state.revision <= m_state->revision) {
        return false; // from before the write whose reply is shown
    }
    m_state = state;
    m_patched = false;
    return true;
}

void TimerView::clear()
{
    m_state.reset();
    m_patched = false;
}

bool TimerView::patch(qint64 revision, const std::optional<TimeEntry> &running)
{
    if (!m_state || m_state->revision > revision) {
        return false; // a newer state came, with this write or after it
    }
    m_state->runningEntry = running;
    const std::optional<qint64> runningId = running ? std::optional<qint64>(running->id) : std::nullopt;
    // A chain stays only while its clone runs, or paused while nothing runs,
    // and a session only while its pomodoro runs.
    if (m_state->pause && !(running ? m_state->pause->cloneEntryId == runningId : m_state->pause->paused)) {
        m_state->pause.reset();
    }
    if (m_state->pomodoro && m_state->pomodoro->entryId != runningId) {
        m_state->pomodoro.reset();
    }
    m_patched = true;
    return true;
}

TimerView::Shown TimerView::shown(qint64 workspaceId, bool hidden) const
{
    Shown shown;
    shown.session = m_state && m_state->pomodoro;
    // The session's pomodoro is the session's.
    if (!m_state || hidden || shown.session) {
        return shown;
    }
    shown.entry = m_state->runningEntry;
    if (shown.entry && shown.entry->workspaceId != workspaceId) {
        shown.entry.reset();
    }
    shown.chain = m_state->pause;
    if (shown.chain
        && (shown.chain->workspaceId != workspaceId || !(shown.entry ? shown.chain->cloneEntryId == shown.entry->id : shown.chain->paused))) {
        shown.chain.reset();
    }
    return shown;
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
