#pragma once

#include "statusitem.h"

#include <QPointer>

#include <memory>

namespace Tokkl
{

// The menu bar item as an NSStatusItem whose button shows text.
//
// QSystemTrayIcon cannot do this: its API has an icon and a tooltip but no
// text, and Qt's Cocoa backend only ever sets the status button's image. It
// also opens its context menu on every click, so a click could not start or
// stop the timer.
//
// A left click emits activated(). A right click or a Control-click opens
// the menu, as the native QMenu Qt keeps for it.
class MacStatusItem : public StatusItem
{
    Q_OBJECT

public:
    explicit MacStatusItem(QObject *parent = nullptr);
    ~MacStatusItem() override;

    void setTitle(const QString &title) override;
    void setToolTip(const QString &toolTip) override;
    void setAccessibleName(const QString &name) override;
    void setMenu(QMenu *menu) override;

private:
    struct Private;
    std::unique_ptr<Private> d;
    QPointer<QMenu> m_menu;
};

}
