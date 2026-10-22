#include "statusimage.h"

namespace Tokkl
{

StatusImage StatusImage::compose(const ProjectIndicator &indicator, bool monochromeLogo)
{
    StatusImage image;
    image.logo = logoImages();
    image.monochromeLogo = monochromeLogo;
    image.logoRect = QRect(0, 0, logoSize, logoSize);
    image.indicator = indicator;
    const int slot = ProjectIndicator::slotSize;
    image.indicatorRect = QRect(image.logoRect.right() + 1 + spacing, (logoSize - slot) / 2, slot, slot);
    image.size = QSize(image.indicatorRect.right() + 1, logoSize);
    return image;
}

const QList<QImage> &StatusImage::logoImages()
{
    static const QList<QImage> images = [] {
        QImage normal(QStringLiteral(":/tokkl/logo/icon_16x16.png"));
        QImage retina(QStringLiteral(":/tokkl/logo/icon_16x16@2x.png"));
        retina.setDevicePixelRatio(2);
        return QList<QImage>{normal, retina};
    }();
    return images;
}

}
