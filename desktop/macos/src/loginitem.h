#pragma once

#include <QString>

namespace Tokkl
{

// Whether the app opens at login. On macOS this is the main app's
// SMAppService registration (MacLoginItem); tests use a fake.
class LoginItem
{
public:
    enum class State {
        Disabled,
        Enabled,
        // Registered, but the user has to allow it in System Settings.
        RequiresApproval,
        // This copy of the app cannot be registered.
        Unavailable,
    };

    virtual ~LoginItem() = default;

    virtual State state() const = 0;
    // Adds or removes the login item. Returns an empty string on success,
    // else a message for the user.
    virtual QString setEnabled(bool enabled) = 0;
};

}
