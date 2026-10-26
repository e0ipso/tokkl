#include "statusimage.h"

namespace Tokkl
{

StatusImage StatusImage::compose(const ProjectIndicator &indicator, bool monochromeLogo)
{
    StatusImage image;
    image.logo = logoImages(monochromeLogo);
    image.monochromeLogo = monochromeLogo;
    image.logoRect = QRect(0, 0, logoSize, logoSize);
    image.indicator = indicator;
    const int slot = ProjectIndicator::slotSize;
    image.indicatorRect = QRect(image.logoRect.right() + 1 + spacing, (logoSize - slot) / 2, slot, slot);
    image.size = QSize(image.indicatorRect.right() + 1, logoSize);
    return image;
}

static QList<QImage> readLogo(const QString &name)
{
    QImage normal(QStringLiteral(":/tokkl/logo/%1_16x16.png").arg(name));
    QImage retina(QStringLiteral(":/tokkl/logo/%1_16x16@2x.png").arg(name));
    retina.setDevicePixelRatio(2);
    return QList<QImage>{normal, retina};
}

const QList<QImage> &StatusImage::logoImages(bool monochrome)
{
    static const QList<QImage> colour = readLogo(QStringLiteral("icon"));
    static const QList<QImage> outline = readLogo(QStringLiteral("mono"));
    return monochrome ? outline : colour;
}

}
