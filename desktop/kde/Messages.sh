#! /usr/bin/env bash
# Extracts the widget's user-visible strings for translators, by the KDE
# convention: the scripty run sets $XGETTEXT and $podir. Plasma loads an
# applet's catalogue under plasma_applet_<plugin id>.
#
# Only the QML is extracted. The C++ strings come from tokklcore and use
# Qt's tr(), which this catalogue does not cover.
$XGETTEXT $(find package -name '*.qml') -o "$podir/plasma_applet_com.canpicasoft.tokkl.pot"
