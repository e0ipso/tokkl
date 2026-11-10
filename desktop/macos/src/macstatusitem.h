#pragma once

#include "statusitem.h"

#include <QElapsedTimer>
#include <QPointer>
#include <QTimer>

#include <memory>

namespace Tokkl
{

// QSystemTrayIcon shows no text and opens its menu on every click. The image
// is never a template image, so the project indicator keeps its colours.
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
    void popUpMenu() override;
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
