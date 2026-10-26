// The copies of the Pomodoro mode glyph each companion ships, against its
// masters in desktop/core/assets: the SVGs are the masters byte for byte,
// and the macOS menu bar PNGs are 8-bit RGBA at 16 points, 1x and 2x. After
// changing a master, copy it again and render the PNGs from desktop/ with
// Qt SVG, which keeps whole-pixel edges sharp where ImageMagick's own SVG
// renderer bleeds a pixel past them:
//
//   ksvgtopng 16 16 core/assets/hourglass.svg /tmp/hourglass.png
//   magick /tmp/hourglass.png -strip -define png:exclude-chunks=date,time \
//       png32:macos/resources/hourglass_16x16.png
//
// and the same at 32 for hourglass_16x16@2x.png, and from hourglass-mono.svg
// for hourglass_mono_16x16.png and its @2x.

#include <QFile>
#include <QTest>
#include <QtEndian>

namespace
{
QString desktopPath(const char *relative)
{
    return QStringLiteral(TOKKL_DESKTOP_DIR "/") + QLatin1String(relative);
}

void readFile(const QString &path, QByteArray &bytes)
{
    QFile file(path);
    QVERIFY2(file.open(QIODevice::ReadOnly), qPrintable(path + QStringLiteral(": ") + file.errorString()));
    bytes = file.readAll();
}
}

class HourglassGlyphTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void svgCopies_data()
    {
        QTest::addColumn<QString>("copy");
        QTest::addColumn<QString>("master");
        const struct {
            const char *copy;
            const char *master;
        } copies[] = {
            {"kde/package/contents/images/hourglass.svg", "core/assets/hourglass.svg"},
            {"kde/package/contents/images/hourglass-mono.svg", "core/assets/hourglass-mono.svg"},
            {"gnome/extension/hourglass.svg", "core/assets/hourglass.svg"},
            {"gnome/extension/hourglass-symbolic.svg", "core/assets/hourglass-mono.svg"},
        };
        for (const auto &row : copies) {
            QTest::newRow(row.copy) << desktopPath(row.copy) << desktopPath(row.master);
        }
    }

    void svgCopies()
    {
        QFETCH(QString, copy);
        QFETCH(QString, master);
        QByteArray masterBytes;
        readFile(master, masterBytes);
        QByteArray copyBytes;
        readFile(copy, copyBytes);
        if (QTest::currentTestFailed()) {
            return;
        }
        QVERIFY(!masterBytes.isEmpty());
        QVERIFY2(copyBytes == masterBytes, qPrintable(copy + QStringLiteral(" differs from ") + master));
    }

    void macPngs_data()
    {
        QTest::addColumn<QString>("path");
        QTest::addColumn<quint32>("pixels");
        for (const char *name : {"hourglass", "hourglass_mono"}) {
            const QString base = desktopPath("macos/resources/") + QLatin1String(name);
            QTest::newRow(name) << base + QStringLiteral("_16x16.png") << quint32(16);
            QTest::newRow(qPrintable(QLatin1String(name) + QStringLiteral("@2x"))) << base + QStringLiteral("_16x16@2x.png") << quint32(32);
        }
    }

    // Read from the PNG signature and the IHDR chunk that must follow it,
    // as the core may not load Qt Gui's image readers.
    void macPngs()
    {
        QFETCH(QString, path);
        QFETCH(quint32, pixels);
        QByteArray bytes;
        readFile(path, bytes);
        if (QTest::currentTestFailed()) {
            return;
        }
        QVERIFY2(bytes.size() >= 33 && bytes.startsWith("\x89PNG\r\n\x1a\n") && bytes.mid(12, 4) == "IHDR",
                 qPrintable(path + QStringLiteral(" is not a PNG")));
        QCOMPARE(qFromBigEndian<quint32>(bytes.constData() + 16), pixels);
        QCOMPARE(qFromBigEndian<quint32>(bytes.constData() + 20), pixels);
        // 8 bits per sample, colour type 6: truecolour with alpha.
        QCOMPARE(int(quint8(bytes.at(24))), 8);
        QCOMPARE(int(quint8(bytes.at(25))), 6);
    }
};

QTEST_GUILESS_MAIN(HourglassGlyphTest)

#include "hourglassglyphtest.moc"
