#pragma once

// What the alarm player asks of the audio. The service's backend talks to
// the sound server (pulsealarmbackend.h); the tests record the calls.

#include <QString>

namespace Tokkl
{

class AlarmBackend
{
public:
    virtual ~AlarmBackend() = default;

    // Plays the file over and over, without a gap, until stop() or the
    // next loop(), which replaces it.
    virtual void loop(const QString &file) = 0;
    // Plays the file once, apart from the loop: a preview while the alarm
    // rings leaves the alarm ringing. A new preview replaces the last.
    virtual void playOnce(const QString &file) = 0;
    // Stops the loop at once. A preview plays out.
    virtual void stop() = 0;
};

}
