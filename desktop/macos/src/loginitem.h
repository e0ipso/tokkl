#pragma once

#include <QString>

namespace Tokkl
{

class LoginItem
{
public:
    enum class State {
        Disabled,
        Enabled,
        // Registered, but the user has to allow it in System Settings.
        RequiresApproval,
        Unavailable,
    };

    virtual ~LoginItem() = default;

    virtual State state() const = 0;
    // Returns an empty string on success, else a message for the user.
    virtual QString setEnabled(bool enabled) = 0;
};

}
