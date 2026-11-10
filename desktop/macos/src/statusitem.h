#pragma once

#include "statusimage.h"

#include <QObject>
#include <QString>

class QMenu;

namespace Tokkl
{

// QSystemTrayIcon cannot show text, so macOS uses an NSStatusItem
// (MacStatusItem); tests use a fake.
class StatusItem : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual void setTitle(const QString &title) = 0;
    virtual void setToolTip(const QString &toolTip) = 0;
    virtual void setAccessibleName(const QString &name) = 0;
    // Not owned.
    virtual void setMenu(QMenu *menu) = 0;
    virtual void popUpMenu() = 0;
    // The item runs the pulse while image.indicator.pulsing is true.
    virtual void setImage(const StatusImage &image) = 0;
    virtual bool reduceMotion() const = 0;

Q_SIGNALS:
    // A primary click.
    void activated();
    void reduceMotionChanged();
};

}
