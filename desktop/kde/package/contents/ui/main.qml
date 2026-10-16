import QtQuick

import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents

import com.github.e0ipso.tokkl.backend

// Placeholder representation. TT-0149 builds the panel timer and menu.
PlasmoidItem {
    id: root

    toolTipMainText: i18n("Tokkl")
    toolTipSubText: i18n("Version %1", Companion.version)

    fullRepresentation: PlasmaComponents.Label {
        text: i18n("Tokkl %1", Companion.version)
    }
}
