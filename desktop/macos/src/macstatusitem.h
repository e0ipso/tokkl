#pragma once

#include "statusitem.h"

#include <QElapsedTimer>
#include <QPointer>
#include <QTimer>

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
//
// The button's image, before the title, draws the StatusImage it is given.
// It is never a template image, so the logo keeps its colours, and the
// project indicator follows the logo. The image is drawn when the menu bar
// draws it, in the menu bar's appearance, so the indicator's ink follows
// light and dark menu bars. A pulse redraws it on a
// timer, which stops when the indicator stops pulsing.
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
    void setImage(const StatusImage &image) override;
    bool reduceMotion() const override;

private:
    void drawImage();

    struct Private;
    std::unique_ptr<Private> d;
    QPointer<QMenu> m_menu;
    StatusImage m_image;
    bool m_hasImage = false;
    QTimer m_pulseTimer;
    QElapsedTimer m_pulseClock;
};

}
