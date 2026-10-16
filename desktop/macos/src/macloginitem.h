#pragma once

#include "loginitem.h"

namespace Tokkl
{

// Opens the app at login through SMAppService.mainAppService (macOS 13 and
// later). System Settings → General → Login Items lists it, and the user can
// turn it off there too, so state() always asks the system.
class MacLoginItem : public LoginItem
{
public:
    State state() const override;
    QString setEnabled(bool enabled) override;
};

}
