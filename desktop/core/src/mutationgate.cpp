#include "mutationgate.h"

#include <utility>

namespace Tokkl
{

using Outcome = TimerActionResult::Outcome;

bool MutationGate::running() const
{
    return m_running;
}

void MutationGate::begin()
{
    m_running = true;
}

void MutationGate::settleWhenDone()
{
    if (m_running) {
        m_settleWhenDone = true;
    }
}

MutationGate::Ending MutationGate::finish(Outcome outcome, const ApiError &error, bool start, bool entryReply)
{
    m_running = false;
    Ending ending;
    // The server may have acted, or did and answered with an entry only.
    // The timer actions have asked the state client to settle already, and
    // adopted the state of an applied one; a v9 write has done neither.
    ending.settle = std::exchange(m_settleWhenDone, false) || outcome == Outcome::Unknown || (outcome == Outcome::Applied && entryReply);

    switch (outcome) {
    case Outcome::Applied:
        ending.message = Message::Clear;
        break;
    case Outcome::Conflict:
        ending.message = Message::Conflict;
        break;
    case Outcome::Unknown:
        ending.message = Message::Show;
        break;
    case Outcome::Refused:
        switch (error.kind) {
        case ApiError::Kind::Forbidden:
            ending.message = Message::LoseWorkspace;
            break;
        case ApiError::Kind::RateLimited:
        case ApiError::Kind::NotConnected:
        case ApiError::Kind::AuthenticationPaused:
            // Refused before the server acted. Reconnection or the end of the
            // cooldown reads the state again.
            ending.message = Message::Show;
            break;
        default:
            // Answered and refused, for example a 409 for an entry that was
            // already stopped. Read what the server has now. A refused start
            // or resume created nothing, so the read cannot answer it: its
            // message stays until the next action.
            ending.message = start ? Message::Keep : Message::Show;
            ending.refresh = true;
            break;
        }
        break;
    }
    return ending;
}

void MutationGate::reset()
{
    m_running = false;
    m_settleWhenDone = false;
}

}
