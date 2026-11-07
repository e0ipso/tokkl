#include "translations.h"

#include "logging.h"

#include <QCoreApplication>
#include <QFileInfo>
#include <QStandardPaths>
#include <QTranslator>

namespace Tokkl
{

namespace
{
// The directory names to try for the locale, in ECM's order.
QStringList languageDirNames(const QLocale &locale)
{
    const QString name = locale.name();
    QStringList names{name, locale.bcp47Name()};
    const qsizetype underscore = name.indexOf(QLatin1Char('_'));
    if (underscore > 0) {
        names.append(name.left(underscore));
    }
    names.removeDuplicates();
    names.removeAll(QString());
    return names;
}
}

QStringList systemLocaleDirs()
{
    return QStandardPaths::locateAll(QStandardPaths::GenericDataLocation, QStringLiteral("locale"), QStandardPaths::LocateDirectory);
}

bool installTranslations(const QString &catalog, const QStringList &dirs, const QLocale &locale)
{
    QCoreApplication *app = QCoreApplication::instance();
    if (!app) {
        return false;
    }
    for (const QString &language : languageDirNames(locale)) {
        for (const QString &dir : dirs) {
            const QString file = dir + QLatin1Char('/') + language + QStringLiteral("/LC_MESSAGES/") + catalog + QStringLiteral(".qm");
            if (!QFileInfo::exists(file)) {
                continue;
            }
            auto *translator = new QTranslator(app);
            if (translator->load(file) && QCoreApplication::installTranslator(translator)) {
                qCDebug(lcTranslations) << "Loaded" << file;
                return true;
            }
            qCWarning(lcTranslations) << "Could not load" << file;
            delete translator;
        }
    }
    return false;
}

}
