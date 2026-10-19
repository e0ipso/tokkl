#pragma once

#include "statusimage.h"

#include <QObject>
#include <QString>

class QMenu;

namespace Tokkl
{

// The app's item in the menu bar. QSystemTrayIcon cannot show text, so on
// macOS this is an NSStatusItem (MacStatusItem); tests use a fake.
class StatusItem : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // The text in the menu bar.
    virtual void setTitle(const QString &title) = 0;
    virtual void setToolTip(const QString &toolTip) = 0;
    // What a screen reader announces for the item.
    virtual void setAccessibleName(const QString &name) = 0;
    // The menu a secondary click opens. The item does not own it.
    virtual void setMenu(QMenu *menu) = 0;
    // The logo and the project indicator, drawn before the text. The item
    // runs the pulse while image.indicator.pulsing is true.
    virtual void setImage(const StatusImage &image) = 0;
    // True when the system asks for reduced motion.
    virtual bool reduceMotion() const = 0;

Q_SIGNALS:
    // A primary click: pause, resume or start the timer.
    void activated();
    // The system's reduced motion setting changed.
    void reduceMotionChanged();
};

}
