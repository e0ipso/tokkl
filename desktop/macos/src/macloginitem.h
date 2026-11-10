#pragma once

#include "loginitem.h"

namespace Tokkl
{

// SMAppService.mainAppService (macOS 13+). The user can turn it off in
// System Settings, so state() always asks the system.
class MacLoginItem : public LoginItem
{
public:
    State state() const override;
    QString setEnabled(bool enabled) override;
};

}
