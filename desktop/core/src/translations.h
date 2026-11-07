#pragma once

#include <QLocale>
#include <QString>
#include <QStringList>

namespace Tokkl
{

// The Qt translation catalogs of the companions and where they are read.
//
// The core's messages (connection states, API errors, credential store and
// Pomodoro texts) use tr() and QCoreApplication::translate() and form the
// catalog coreCatalog. A companion whose own C++ uses tr() has a catalog of
// its own: tokkl_timerd_qt for the GNOME daemon, tokkl_macos_qt for the
// macOS app. KDE's QML uses KI18n under plasma_applet_<id> and the GNOME
// extension gettext under tokkl-gnome-extension; neither covers these.
//
// A catalog is a .qm file in the gettext layout that KDE's ECM installs:
// <locale dir>/<language>/LC_MESSAGES/<catalog>.qm. The KDE widget loads the
// core's catalog with ecm_create_qm_loader from share/locale of the XDG data
// dirs; the GNOME daemon looks in the same dirs (systemLocaleDirs()), and the
// macOS app in Tokkl.app/Contents/Resources/locale. No catalog ships yet, so
// every companion shows the English source text.
inline const QString coreCatalog = QStringLiteral("tokklcore_qt");

// share/locale under each XDG data dir, the most important first.
QStringList systemLocaleDirs();

// Installs a translator for catalog into the application, for the locale
// tried as ECM's loader tries it: its name (de_DE), its BCP 47 name, then
// its language alone. The first directory of dirs that has the file wins.
// Returns false, and installs nothing, without an application or when no
// directory has a catalog for the locale.
bool installTranslations(const QString &catalog, const QStringList &dirs, const QLocale &locale = QLocale());

}
