pragma ComponentBehavior: Bound

import QtQuick

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

import com.canpicasoft.tokkl.backend

// The panel timer and the Pomodoro session: PanelButton shows them and opens
// PanelMenu.
PlasmoidItem {
    id: root

    // The account connection, configured from the Connection settings page.
    readonly property TokklConnection connection: TokklConnection {
        instanceUrl: Plasmoid.configuration.instanceUrl
        authMode: Plasmoid.configuration.authMode
        email: Plasmoid.configuration.email
    }

    // The account's timer state as the server holds it, read once for the
    // timer and the Pomodoro session to share.
    readonly property TokklTimerState timerState: TokklTimerState {
        connection: root.connection
    }

    // The running entry, its elapsed time, the pause chain and the start,
    // pause, resume and stop actions, on the server's timer state.
    readonly property TokklTimer timer: TokklTimer {
        stateClient: root.timerState.client
    }

    // Keeps Pomodoro mode in this widget's configuration, so a plasmashell
    // restart keeps it. The session itself is the server's.
    readonly property TokklPomodoroStore pomodoroStore: TokklPomodoroStore {
        applet: Plasmoid
    }

    // Builds the Pomodoro session and the lengths client on the timer's
    // state client. Its session is null until this document is complete.
    readonly property TokklPomodoro pomodoro: TokklPomodoro {
        timer: root.timer
        store: root.pomodoroStore
    }

    // Keeps the account's lengths, as the session knows them, in the
    // widget's settings for the Pomodoro settings page, which cannot reach
    // the session.
    readonly property PomodoroLengthsCache lengthsCache: PomodoroLengthsCache {
        configuration: Plasmoid.configuration
        connection: root.connection
        preferences: root.pomodoro.preferences
    }

    // Loops the sound chosen for the transition while the session rings.
    readonly property TokklAlarm alarm: TokklAlarm {
        ringing: root.pomodoro.session !== null && root.pomodoro.session.ringing
        transition: root.pomodoro.session !== null ? root.pomodoro.session.ringingTransition : ""
        sounds: ({
                workToShortRest: Plasmoid.configuration.workToShortRestSound,
                shortRestToWork: Plasmoid.configuration.shortRestToWorkSound,
                workToLongRest: Plasmoid.configuration.workToLongRestSound,
                longRestToWork: Plasmoid.configuration.longRestToWorkSound
            })
    }

    readonly property StatusText words: StatusText {
        timer: root.timer
        session: root.pomodoro.session
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
        session: root.pomodoro.session
        // The configured base URL only: it never holds credentials.
        onOpenRequested: url => Qt.openUrlExternally(url)
        onConfigureRequested: Plasmoid.internalAction("configure").trigger()
    }
}
