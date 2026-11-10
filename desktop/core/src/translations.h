#pragma once

#include <QLocale>
#include <QString>
#include <QStringList>

namespace Tokkl
{

// The core's tr() messages. KDE's QML (KI18n) and the GNOME extension
// (gettext) do not use it.
inline const QString coreCatalog = QStringLiteral("tokklcore_qt");

// Most important first.
QStringList systemLocaleDirs();

// Tries the locale as ECM's loader does: name (de_DE), BCP 47 name, then
// language. The first dir that has the file wins.
bool installTranslations(const QString &catalog, const QStringList &dirs, const QLocale &locale = QLocale());

}
