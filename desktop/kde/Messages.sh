#! /usr/bin/env bash
# Extracts the widget's user-visible strings for translators, by the KDE
# convention: the scripty run sets $XGETTEXT, $EXTRACT_TR_STRINGS and $podir.
# Plasma loads an applet's catalogue under plasma_applet_<plugin id>.
#
# The QML goes to that catalogue. The C++ strings come from tokklcore and use
# Qt's tr(), so they go to the Qt catalogue tokklcore_qt, which the backend
# module loads (see desktop/core/src/translations.h).
$XGETTEXT $(find package -name '*.qml') -o "$podir/plasma_applet_com.canpicasoft.tokkl.pot"
$EXTRACT_TR_STRINGS $(find ../core/src -name '*.cpp' -o -name '*.h') -o "$podir/tokklcore_qt.pot"
