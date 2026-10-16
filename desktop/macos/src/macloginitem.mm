#include "macloginitem.h"

#include <QCoreApplication>

#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>

// Compiled with ARC.

namespace Tokkl
{

LoginItem::State MacLoginItem::state() const
{
    switch (SMAppService.mainAppService.status) {
    case SMAppServiceStatusEnabled:
        return State::Enabled;
    case SMAppServiceStatusRequiresApproval:
        return State::RequiresApproval;
    case SMAppServiceStatusNotRegistered:
        return State::Disabled;
    case SMAppServiceStatusNotFound:
        break;
    }
    return State::Unavailable;
}

QString MacLoginItem::setEnabled(bool enabled)
{
    SMAppService *service = SMAppService.mainAppService;
    NSError *error = nil;
    const BOOL done = enabled ? [service registerAndReturnError:&error] : [service unregisterAndReturnError:&error];
    if (done) {
        return QString();
    }
    const QString reason = error ? QString::fromNSString(error.localizedDescription) : QString();
    return enabled ? QCoreApplication::translate("Tokkl::MacLoginItem", "Tokkl could not be added to the login items. %1").arg(reason).trimmed()
                   : QCoreApplication::translate("Tokkl::MacLoginItem", "Tokkl could not be removed from the login items. %1").arg(reason).trimmed();
}

}
