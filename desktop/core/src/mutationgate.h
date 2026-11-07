#pragma once

#include "apitypes.h"

namespace Tokkl
{

// The one timer write a controller lets run at a time, and what its end
// means for the state shown and the message.
//
// A write whose outcome is unknown (no answer, timeout, 5xx, unreadable
// answer) leaves the state to settle: the controller stays busy until a read
// sent after the failure brings a state, and never sends the write again.
// The same holds for a write that was in flight when the workspace was lost.
class MutationGate
{
public:
    // What to do with the message once a write ends.
    enum class Message {
        Clear, // applied
        Show, // shown until the next state clears it
        Keep, // shown until the next user action
        Conflict, // a 409: the server's state is shown, and a message says so
        LoseWorkspace, // a 403: the workspace is gone
    };

    struct Ending {
        // Read until a state from after the write shows. A read already
        // settling does as well.
        bool settle = false;
        // The write was applied and its reply holds only the entry: read
        // the rest of the state.
        bool readRest = false;
        Message message = Message::Clear;
        // Read the state again: the server answered and refused.
        bool refresh = false;
    };

    // A write runs.
    bool running() const;
    void begin();
    // The workspace was lost. A write in flight settles once it answers.
    void settleWhenDone();
    // Ends the write. start is true for a start or a resume, and entryReply
    // for a v9 write, whose reply is an entry rather than the whole state.
    Ending finish(TimerActionResult::Outcome outcome, const ApiError &error, bool start, bool entryReply);
    // Forgets the write, as for a new generation.
    void reset();

private:
    bool m_running = false;
    bool m_settleWhenDone = false;
};

}
