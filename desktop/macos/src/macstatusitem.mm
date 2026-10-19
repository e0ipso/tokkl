#include "macstatusitem.h"

#include <QColor>
#include <QImage>
#include <QMenu>
#include <QRect>

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

namespace
{
NSColor *toNSColor(const QColor &color, double opacity = 1.0)
{
    const QColor rgb = color.toRgb();
    return [NSColor colorWithSRGBRed:rgb.redF() green:rgb.greenF() blue:rgb.blueF() alpha:rgb.alphaF() * opacity];
}

bool isDark(NSAppearance *appearance)
{
    NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
    return [match isEqualToString:NSAppearanceNameDarkAqua];
}

NSBezierPath *shapePath(bool round, NSRect box, CGFloat radius)
{
    return round ? [NSBezierPath bezierPathWithOvalInRect:box] : [NSBezierPath bezierPathWithRoundedRect:box xRadius:radius yRadius:radius];
}

// Draws the indicator centred in the slot, with the shapes of the KDE panel.
void paintIndicator(const Tokkl::ProjectIndicator &indicator, double fillOpacity, NSRect slot)
{
    using Indicator = Tokkl::ProjectIndicator;
    if (indicator.kind == Indicator::Kind::Empty) {
        return;
    }
    // The image draws when the status button draws, in the menu bar's
    // appearance, so the ink matches the menu bar's text.
    const bool dark = isDark(NSAppearance.currentDrawingAppearance);
    NSColor *ink = toNSColor(Indicator::inkColor(dark));
    const CGFloat size = Indicator::shapeSize;
    const NSRect box = NSMakeRect(NSMidX(slot) - size / 2, NSMidY(slot) - size / 2, size, size);
    // A one point stroke centred half a point inside the box stays inside it.
    const NSRect edge = NSInsetRect(box, 0.5, 0.5);

    if (indicator.kind == Indicator::Kind::Outline) {
        NSBezierPath *outline = shapePath(indicator.round, edge, 0);
        const CGFloat dash[] = {Indicator::dashLength, Indicator::dashLength};
        [outline setLineDash:dash count:2 phase:0];
        outline.lineWidth = 1;
        [ink setStroke];
        [outline stroke];
        return;
    }

    const CGFloat radius = Indicator::squareRadius;
    [toNSColor(indicator.fillColor(dark), fillOpacity) setFill];
    [shapePath(indicator.round, box, radius) fill];
    // The ring never fades, so the edge keeps its contrast during the pulse.
    NSBezierPath *ring = shapePath(indicator.round, edge, radius - 0.5);
    ring.lineWidth = 1;
    [ink setStroke];
    [ring stroke];
}

// The rect in an unflipped image of the given height, whose origin is at the
// bottom left.
NSRect toNSRect(const QRect &rect, int imageHeight)
{
    return NSMakeRect(rect.x(), imageHeight - rect.y() - rect.height(), rect.width(), rect.height());
}

// One NSImage with a representation per image, so AppKit picks the pixels
// that match the screen.
NSImage *toNSImage(const QList<QImage> &images, NSSize size)
{
    NSImage *image = [[NSImage alloc] initWithSize:size];
    for (const QImage &pixels : images) {
        CGImageRef cgImage = pixels.convertToFormat(QImage::Format_ARGB32_Premultiplied).toCGImage();
        if (!cgImage) {
            continue;
        }
        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cgImage];
        CGImageRelease(cgImage);
        rep.size = size;
        [image addRepresentation:rep];
    }
    return image;
}
}

namespace Tokkl
{

struct MacStatusItem::Private {
    NSStatusItem *item = nil;
    TokklStatusItemTarget *target = nil;
    id reduceMotionObserver = nil;
    // The logo of the current image, made once instead of on every redraw.
    NSImage *logo = nil;
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
    button.imagePosition = NSImageLeading;
    button.imageHugsTitle = YES;

    // Redraws the pulsing fill about 15 times a second.
    m_pulseTimer.setInterval(66);
    connect(&m_pulseTimer, &QTimer::timeout, this, &MacStatusItem::drawImage);

    // Reduce Motion in System Settings → Accessibility → Display.
    d->reduceMotionObserver = [NSWorkspace.sharedWorkspace.notificationCenter
        addObserverForName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification
                    object:nil
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification *notification) {
                    Q_UNUSED(notification);
                    Q_EMIT reduceMotionChanged();
                }];
}

MacStatusItem::~MacStatusItem()
{
    m_pulseTimer.stop();
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:d->reduceMotionObserver];
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

void MacStatusItem::setImage(const StatusImage &image)
{
    if (m_hasImage && image == m_image) {
        return;
    }
    const bool wasPulsing = m_hasImage && m_image.indicator.pulsing;
    if (!m_hasImage || image.logo != m_image.logo || image.logoRect.size() != m_image.logoRect.size()) {
        d->logo = toNSImage(image.logo, NSMakeSize(image.logoRect.width(), image.logoRect.height()));
    }
    m_image = image;
    m_hasImage = true;
    if (!image.indicator.pulsing) {
        m_pulseTimer.stop();
    } else if (!wasPulsing) {
        m_pulseClock.start();
        m_pulseTimer.start();
    }
    drawImage();
}

bool MacStatusItem::reduceMotion() const
{
    return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}

void MacStatusItem::drawImage()
{
    const ProjectIndicator indicator = m_image.indicator;
    const double fillOpacity = indicator.pulsing ? ProjectIndicator::pulseOpacity(m_pulseClock.elapsed()) : 1.0;
    const int height = m_image.size.height();
    const NSRect logoRect = toNSRect(m_image.logoRect, height);
    const NSRect indicatorRect = toNSRect(m_image.indicatorRect, height);
    NSImage *logo = d->logo;
    NSImage *image = [NSImage imageWithSize:NSMakeSize(m_image.size.width(), height)
                                    flipped:NO
                             drawingHandler:^BOOL(NSRect rect) {
                                 Q_UNUSED(rect);
                                 [logo drawInRect:logoRect fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1.0];
                                 paintIndicator(indicator, fillOpacity, indicatorRect);
                                 return YES;
                             }];
    // Draw again for each appearance instead of keeping the first drawing.
    image.cacheMode = NSImageCacheNever;
    // A template image would lose the logo's colours to the menu bar's.
    // template is a C++ keyword, so this calls the setter.
    [image setTemplate:NO];
    // VoiceOver reads the button's label, which also names the project.
    image.accessibilityDescription = indicator.label.toNSString();
    d->item.button.image = image;
}

}
