pragma ComponentBehavior: Bound

import QtQuick

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

import com.canpicasoft.tokkl.backend

// The panel timer and the Pomodoro session: PanelButton shows them and opens
// PanelMenu.
PlasmoidItem {
    id: root

    // The account connection, the server's timer state, the timer and the
    // Pomodoro session, built together on one clock. The connection is
    // configured from the Connection settings page. Pomodoro mode is kept in
    // this widget's configuration, so a plasmashell restart keeps it; the
    // session itself is the server's.
    readonly property TokklTimerState timerState: TokklTimerState {
        applet: Plasmoid
        connection.instanceUrl: Plasmoid.configuration.instanceUrl
        connection.authMode: Plasmoid.configuration.authMode
        connection.email: Plasmoid.configuration.email
    }

    readonly property TokklConnection connection: root.timerState.connection

    // The running entry, its elapsed time, the pause chain and the start,
    // pause, resume and stop actions, on the server's timer state.
    readonly property TokklTimer timer: root.timerState.timer

    readonly property TokklPomodoroSession session: root.timerState.session

    // Keeps the account's lengths, as the session knows them, in the
    // widget's settings for the Pomodoro settings page, which cannot reach
    // the session.
    readonly property PomodoroLengthsCache lengthsCache: PomodoroLengthsCache {
        configuration: Plasmoid.configuration
        connection: root.connection
        preferences: root.timerState.preferences
    }

    // Loops the sound chosen for the transition while the session rings.
    readonly property TokklAlarm alarm: TokklAlarm {
        ringing: root.session.ringing
        transition: root.session.ringingTransition
        sounds: ({
                workToShortRest: Plasmoid.configuration.workToShortRestSound,
                shortRestToWork: Plasmoid.configuration.shortRestToWorkSound,
                workToLongRest: Plasmoid.configuration.workToLongRestSound,
                longRestToWork: Plasmoid.configuration.longRestToWorkSound
            })
    }

    // A Pomodoro lengths save the settings page sent, whose refusal may
    // come after the dialog has closed.
    readonly property TokklLengthsSaveStatus lengthsSave: TokklLengthsSaveStatus {
        connection: root.connection
    }

    readonly property StatusText words: StatusText {
        timer: root.timer
        session: root.session
        lengthsSave: root.lengthsSave
        alarm: root.alarm
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
        session: root.session
        words: root.words
        // The configured base URL only: it never holds credentials.
        onOpenRequested: url => Qt.openUrlExternally(url)
        onConfigureRequested: Plasmoid.internalAction("configure").trigger()
    }
}
