// installTranslations() against catalogs in a temporary locale directory:
// which file it picks for a locale, and that it installs nothing without one.

#include "translations.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QTest>
#include <QTranslator>

using namespace Tokkl;

namespace
{
// A catalog with one message, which lrelease built from a .ts file that
// translates "source text" in the context TranslationsTest as
// "translated text". Qt 6.8 refuses a catalog without messages.
const QByteArray testCatalog = QByteArray::fromHex(
    "3cb86418caef9c95cd211cbf60a1bddd4200000008090dc0740000000069"
    "0000004e030000001e007400720061006e0073006c006100740065006400"
    "2000740065007800740800000000060000000b736f757263652074657874"
    "07000000105472616e736c6174696f6e735465737401");

void writeCatalog(const QString &localeDir, const QString &language, const QByteArray &content = testCatalog)
{
    const QString dir = localeDir + QLatin1Char('/') + language + QStringLiteral("/LC_MESSAGES");
    QVERIFY(QDir().mkpath(dir));
    QFile file(dir + QLatin1Char('/') + coreCatalog + QStringLiteral(".qm"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    QCOMPARE(file.write(content), content.size());
}

int installedTranslators()
{
    return int(QCoreApplication::instance()->findChildren<QTranslator *>().size());
}
}

class TranslationsTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void cleanup()
    {
        qDeleteAll(QCoreApplication::instance()->findChildren<QTranslator *>());
    }

    void theFullLocaleNameComesFirst()
    {
        QTemporaryDir dir;
        writeCatalog(dir.path(), QStringLiteral("pt_BR"));
        writeCatalog(dir.path(), QStringLiteral("pt"));
        QVERIFY(installTranslations(coreCatalog, {dir.path()}, QLocale(QStringLiteral("pt_BR"))));
        QCOMPARE(installedTranslators(), 1);
        QCOMPARE(QCoreApplication::instance()->findChild<QTranslator *>()->filePath(),
                 dir.path() + QStringLiteral("/pt_BR/LC_MESSAGES/tokklcore_qt.qm"));
        QCOMPARE(QCoreApplication::translate("TranslationsTest", "source text"), QStringLiteral("translated text"));
    }

    void theLanguageAloneIsTheLastTry()
    {
        QTemporaryDir dir;
        writeCatalog(dir.path(), QStringLiteral("de"));
        QVERIFY(installTranslations(coreCatalog, {dir.path()}, QLocale(QStringLiteral("de_AT"))));
        QCOMPARE(QCoreApplication::instance()->findChild<QTranslator *>()->filePath(), dir.path() + QStringLiteral("/de/LC_MESSAGES/tokklcore_qt.qm"));
    }

    void theFirstDirectoryWithTheFileWins()
    {
        QTemporaryDir user;
        QTemporaryDir system;
        writeCatalog(system.path(), QStringLiteral("fr"));
        QVERIFY(installTranslations(coreCatalog, {user.path(), system.path()}, QLocale(QStringLiteral("fr_FR"))));
        QVERIFY(QCoreApplication::instance()->findChild<QTranslator *>()->filePath().startsWith(system.path()));
    }

    void noCatalogInstallsNothing()
    {
        QTemporaryDir dir;
        writeCatalog(dir.path(), QStringLiteral("de"));
        QVERIFY(!installTranslations(coreCatalog, {dir.path()}, QLocale(QStringLiteral("fr_FR"))));
        QVERIFY(!installTranslations(QStringLiteral("tokkl_other_qt"), {dir.path()}, QLocale(QStringLiteral("de"))));
        QCOMPARE(installedTranslators(), 0);
        QCOMPARE(QCoreApplication::translate("TranslationsTest", "source text"), QStringLiteral("source text"));
    }

    void aBrokenCatalogInstallsNothing()
    {
        QTemporaryDir dir;
        writeCatalog(dir.path(), QStringLiteral("de"), QByteArrayLiteral("not a catalog"));
        QVERIFY(!installTranslations(coreCatalog, {dir.path()}, QLocale(QStringLiteral("de"))));
        QCOMPARE(installedTranslators(), 0);
    }
};

QTEST_GUILESS_MAIN(TranslationsTest)

#include "translationstest.moc"
