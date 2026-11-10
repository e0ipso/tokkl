#pragma once

#include "apitypes.h"

namespace Tokkl
{

// A write with an unknown outcome is never resent: the controller stays busy
// until a read sent after the failure brings a state.
class MutationGate
{
public:
    enum class Message {
        Clear, // applied
        Show, // shown until the next state clears it
        Keep, // shown until the next user action
        Conflict, // a 409: the server's state is shown, and a message says so
        LoseWorkspace, // a 403: the workspace is gone
    };

    struct Ending {
        // Read until a state from after the write shows.
        bool settle = false;
        Message message = Message::Clear;
        // The server answered and refused.
        bool refresh = false;
    };

    bool running() const;
    void begin();
    // A write in flight settles once it answers.
    void settleWhenDone();
    // start is true for a start or a resume.
    Ending finish(TimerActionResult::Outcome outcome, const ApiError &error, bool start);
    void reset();

private:
    bool m_running = false;
    bool m_settleWhenDone = false;
};

}
