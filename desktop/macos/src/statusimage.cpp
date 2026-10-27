#include "statusimage.h"

namespace Tokkl
{

StatusImage StatusImage::compose(const ProjectIndicator &indicator, bool monochromeLogo, bool pomodoroMode)
{
    StatusImage image;
    image.logo = logoImages(monochromeLogo);
    image.monochromeLogo = monochromeLogo;
    image.logoRect = QRect(0, 0, logoSize, logoSize);
    image.indicator = indicator;
    const int slot = ProjectIndicator::slotSize;
    image.indicatorRect = QRect(image.logoRect.right() + 1 + spacing, (logoSize - slot) / 2, slot, slot);
    QRect last = image.indicatorRect;
    if (pomodoroMode) {
        image.hourglass = hourglassImages(monochromeLogo);
        image.hourglassRect = QRect(image.indicatorRect.right() + 1 + spacing, 0, logoSize, logoSize);
        last = image.hourglassRect;
    }
    image.size = QSize(last.right() + 1, logoSize);
    return image;
}

// The 1x and 2x images of a 16 point resource such as
// :/tokkl/logo/icon_16x16.png.
static QList<QImage> readPair(const QString &path)
{
    QImage normal(QStringLiteral(":/tokkl/%1_16x16.png").arg(path));
    QImage retina(QStringLiteral(":/tokkl/%1_16x16@2x.png").arg(path));
    retina.setDevicePixelRatio(2);
    return QList<QImage>{normal, retina};
}

const QList<QImage> &StatusImage::logoImages(bool monochrome)
{
    static const QList<QImage> colour = readPair(QStringLiteral("logo/icon"));
    static const QList<QImage> outline = readPair(QStringLiteral("logo/mono"));
    return monochrome ? outline : colour;
}

const QList<QImage> &StatusImage::hourglassImages(bool monochrome)
{
    static const QList<QImage> colour = readPair(QStringLiteral("hourglass/hourglass"));
    static const QList<QImage> outline = readPair(QStringLiteral("hourglass/hourglass_mono"));
    return monochrome ? outline : colour;
}

}
