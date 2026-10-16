#include "macstatusitem.h"

#include <QMenu>

#include <functional>
#include <utility>

#import <AppKit/AppKit.h>

// Compiled with ARC.

// Receives the status button's action and passes it to the C++ item.
@interface TokklStatusItemTarget : NSObject
- (instancetype)initWithHandler:(std::function<void(bool secondary)>)handler;
- (void)buttonClicked:(id)sender;
@end

@implementation TokklStatusItemTarget {
    std::function<void(bool secondary)> _handler;
}

- (instancetype)initWithHandler:(std::function<void(bool secondary)>)handler
{
    if ((self = [super init])) {
        _handler = std::move(handler);
    }
    return self;
}

- (void)buttonClicked:(id)sender
{
    Q_UNUSED(sender);
    // A right click or a Control-click asks for the menu. Anything else,
    // including an accessibility press with no mouse event, is a primary
    // click.
    NSEvent *event = NSApp.currentEvent;
    const BOOL secondary = event != nil
        && (event.type == NSEventTypeRightMouseUp || event.type == NSEventTypeRightMouseDown
            || (event.modifierFlags & NSEventModifierFlagControl) != 0);
    if (_handler) {
        _handler(secondary == YES);
    }
}

@end

namespace Tokkl
{

struct MacStatusItem::Private {
    NSStatusItem *item = nil;
    TokklStatusItemTarget *target = nil;
};

MacStatusItem::MacStatusItem(QObject *parent)
    : StatusItem(parent)
    , d(std::make_unique<Private>())
{
    d->item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    // Keeps the position the user dragged the item to.
    d->item.autosaveName = @"com.github.e0ipso.tokkl.timer";

    // The target lives no longer than this object, which owns it.
    std::function<void(bool)> handler = [this](bool secondary) {
        if (!secondary || !m_menu) {
            Q_EMIT activated();
            return;
        }
        // The menu is attached only for this click: with a menu attached,
        // every click would open it. performClick: opens it and returns when
        // it closes.
        d->item.menu = m_menu->toNSMenu();
        [d->item.button performClick:nil];
        d->item.menu = nil;
    };
    d->target = [[TokklStatusItemTarget alloc] initWithHandler:std::move(handler)];

    NSStatusBarButton *button = d->item.button;
    button.target = d->target;
    button.action = @selector(buttonClicked:);
    [button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];
    // Digits of the same width, so the item does not shift every second.
    button.font = [NSFont monospacedDigitSystemFontOfSize:[NSFont menuBarFontOfSize:0].pointSize weight:NSFontWeightRegular];
    button.title = @"Tokkl";
}

MacStatusItem::~MacStatusItem()
{
    d->item.button.target = nil;
    d->item.menu = nil;
    [NSStatusBar.systemStatusBar removeStatusItem:d->item];
}

void MacStatusItem::setTitle(const QString &title)
{
    d->item.button.title = title.toNSString();
}

void MacStatusItem::setToolTip(const QString &toolTip)
{
    d->item.button.toolTip = toolTip.toNSString();
}

void MacStatusItem::setAccessibleName(const QString &name)
{
    d->item.button.accessibilityLabel = name.toNSString();
}

void MacStatusItem::setMenu(QMenu *menu)
{
    m_menu = menu;
}

}
