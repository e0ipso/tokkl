pragma ComponentBehavior: Bound

import QtQuick

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

import com.github.e0ipso.tokkl.backend

// The panel timer: PanelButton shows it and opens PanelMenu.
PlasmoidItem {
    id: root

    // The account connection, configured from the Connection settings page.
    readonly property TokklConnection connection: TokklConnection {
        instanceUrl: Plasmoid.configuration.instanceUrl
        authMode: Plasmoid.configuration.authMode
        email: Plasmoid.configuration.email
    }

    // The running entry, its elapsed time, the pause chain and the start,
    // pause, resume and stop actions.
    readonly property TokklTimer timer: TokklTimer {
        connection: root.connection
    }

    // Keeps the pause chain in this widget's configuration, so a plasmashell
    // restart keeps its total.
    readonly property TokklChainStore chainStore: TokklChainStore {
        applet: Plasmoid
        timer: root.timer
    }

    readonly property StatusText words: StatusText {
        timer: root.timer
    }

    // Keep the timer inline in the panel. Plasma does not select a compact
    // representation when no full representation has been provided.
    preferredRepresentation: fullRepresentation

    toolTipMainText: i18n("Tokkl: %1", words.summary)
    toolTipSubText: i18n("Version %1", Companion.version)

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: i18nc("@action", "Reconnect")
            icon.name: "view-refresh"
            onTriggered: root.timer.reconnect()
        }
    ]

    fullRepresentation: PanelButton {
        monochromeIcon: Plasmoid.configuration.monochromeIcon
        timer: root.timer
        // The configured base URL only: it never holds credentials.
        onOpenRequested: url => Qt.openUrlExternally(url)
        onConfigureRequested: Plasmoid.internalAction("configure").trigger()
    }
}
