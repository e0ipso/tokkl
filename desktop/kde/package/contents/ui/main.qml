pragma ComponentBehavior: Bound

import QtQuick

import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

import com.canpicasoft.tokkl.backend

PlasmoidItem {
    id: root

    readonly property TokklTimerState timerState: TokklTimerState {
        applet: Plasmoid
        connection.instanceUrl: Plasmoid.configuration.instanceUrl
        connection.authMode: Plasmoid.configuration.authMode
        connection.email: Plasmoid.configuration.email
    }

    readonly property TokklConnection connection: root.timerState.connection

    readonly property TokklTimer timer: root.timerState.timer

    readonly property TokklPomodoroSession session: root.timerState.session

    // The Pomodoro settings page cannot reach the session, so it reads these.
    readonly property PomodoroLengthsCache lengthsCache: PomodoroLengthsCache {
        configuration: Plasmoid.configuration
        connection: root.connection
        preferences: root.timerState.preferences
    }

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

    readonly property TokklLengthsSaveStatus lengthsSave: TokklLengthsSaveStatus {
        connection: root.connection
    }

    readonly property StatusText words: StatusText {
        timer: root.timer
        session: root.session
        lengthsSave: root.lengthsSave
        alarm: root.alarm
    }

    // Plasma selects no compact representation without a full one.
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
        // The base URL only; it never holds credentials.
        onOpenRequested: url => Qt.openUrlExternally(url)
        onConfigureRequested: Plasmoid.internalAction("configure").trigger()
    }
}
