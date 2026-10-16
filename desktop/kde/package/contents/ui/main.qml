import QtQuick

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents

import com.github.e0ipso.tokkl.backend

// Placeholder representation. TT-0149 builds the panel timer and menu.
PlasmoidItem {
    id: root

    // The account connection, configured from the Connection settings page.
    readonly property TokklConnection connection: TokklConnection {
        instanceUrl: Plasmoid.configuration.instanceUrl
        authMode: Plasmoid.configuration.authMode
        email: Plasmoid.configuration.email
    }

    // The running entry, its elapsed time and the start/stop actions.
    readonly property TokklTimer timer: TokklTimer {
        connection: root.connection
    }

    readonly property string connectionText: {
        switch (connection.state) {
        case TokklConnection.Unconfigured:
            return i18n("Set the instance URL in the widget settings.");
        case TokklConnection.LoadingCredentials:
        case TokklConnection.Connecting:
            return i18n("Connecting…");
        case TokklConnection.Connected:
            return i18n("Connected as %1", connection.account.fullname || connection.account.email);
        default:
            return connection.errorString;
        }
    }

    toolTipMainText: i18n("Tokkl")
    toolTipSubText: i18n("Version %1", Companion.version)

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: i18nc("@action", "Reconnect")
            icon.name: "view-refresh"
            onTriggered: root.timer.reconnect()
        }
    ]

    fullRepresentation: PlasmaComponents.Label {
        text: i18n("Tokkl %1", Companion.version) + "\n" + root.connectionText
            + (root.timer.running ? "\n" + i18n("Running: %1", root.timer.elapsedText) : "")
        wrapMode: Text.Wrap
    }
}
