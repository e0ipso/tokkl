pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Templates as T
import org.kde.plasma.components as PlasmaComponents

import com.github.e0ipso.tokkl.backend

// The panel item's menu: state, the session's message, Start session, Next
// phase, End session, Start or Stop, Project, Billable, Pomodoro mode,
// Reconnect, Open Tokkl and Configure. Arrow keys move, Right opens Project,
// Return or Space triggers and Escape closes. A hidden entry is disabled too,
// so the arrow keys skip it.
//
// The session is the server's, so Next phase and End session show whenever
// one is active, in either mode and whichever device started it, and the
// state line then names the phase. Start or Stop is hidden then, as the
// session owns its pomodoro. Without a session it shows in Timer mode, and
// in Pomodoro mode while a timer runs or is paused, so Pomodoro mode starts
// no timer. In Pomodoro mode Start session shows while no session is active
// and no timer runs or is paused. Pomodoro mode is locked while a timer
// runs or is paused, or a session is active.
//
// Stop ends the timer and its pause chain; while paused it asks the server
// to discard the chain. Project sets only the project of the next start and
// is locked while an entry runs or is paused: changing it means stopping and
// starting a new entry. Billable sets the next start too and, while an entry
// runs, edits that entry in place; while paused the timer refuses it. Both
// are disabled whenever the timer cannot write, so nothing is sent for an
// account that is not connected. During a session both are disabled, as
// neither reaches the open pomodoro.
PlasmaComponents.Menu {
    id: menu

    required property TokklTimer timer
    // Null until the backend has built it, which reads as Timer mode.
    property TokklPomodoroSession session: null
    required property StatusText words

    // Pomodoro mode is on and no timer runs or is paused.
    readonly property bool pomodoroIdle: menu.words.pomodoroMode && !menu.timer.running && !menu.timer.paused
    readonly property bool sessionActive: menu.session !== null && menu.session.active

    property alias stateItem: stateItem
    property alias messageItem: messageItem
    property alias startSessionItem: startSessionItem
    property alias nextPhaseItem: nextPhaseItem
    property alias endSessionItem: endSessionItem
    property alias runItem: runItem
    property alias projectMenu: projectMenu
    property alias noProjectItem: noProjectItem
    property alias billableItem: billableItem
    property alias modeItem: modeItem
    property alias reconnectItem: reconnectItem
    property alias openItem: openItem
    property alias configureItem: configureItem

    signal openRequested(url url)
    signal configureRequested

    // A separate window, so the menu is not clipped to the panel.
    popupType: T.Popup.Window
    // Plasma's own delegate binds to its parent before it has one.
    delegate: PlasmaComponents.MenuItem {}

    // Shows the controller's state; a click asks the controller instead of
    // flipping the check mark itself.
    component ChoiceItem: PlasmaComponents.MenuItem {
        required property bool selected

        checkable: true
        checked: selected
        onToggled: checked = Qt.binding(() => selected)
    }

    // An entry shown only in some states. Hidden, it takes no room and is
    // disabled, so the keyboard never lands on it.
    component OptionalItem: PlasmaComponents.MenuItem {
        required property bool shown
        property bool available: true

        visible: shown
        enabled: shown && available
        height: shown ? implicitHeight : 0
    }

    // Another instance, account or secret: close, so no choice made for the
    // previous context can be triggered.
    Connections {
        target: menu.timer.connection
        ignoreUnknownSignals: true

        function onGenerationChanged() {
            menu.dismiss();
        }
    }

    PlasmaComponents.MenuItem {
        id: stateItem
        enabled: false
        text: menu.words.showsSession ? menu.words.sessionText : i18nc("@item:inmenu running state, elapsed time, connection state", "%1 %2 · %3", menu.words.runText, menu.timer.elapsedText, menu.words.statusText)
        Accessible.description: menu.words.detailText
    }

    // The session's message, such as a pomodoro too short to save or an
    // action that could not reach the instance.
    OptionalItem {
        id: messageItem
        shown: messageItem.text.length > 0
        available: false
        text: menu.words.messageText
    }

    OptionalItem {
        id: startSessionItem
        shown: menu.pomodoroIdle && !menu.sessionActive
        available: menu.session !== null && menu.session.canStartSession
        text: i18nc("@action:inmenu", "Start session")
        icon.name: "media-playback-start"
        onTriggered: menu.session.startSession()
    }

    OptionalItem {
        id: nextPhaseItem
        shown: menu.sessionActive
        text: menu.words.nextPhaseText
        icon.name: "media-skip-forward"
        onTriggered: menu.session.confirmNextPhase()
    }

    OptionalItem {
        id: endSessionItem
        shown: menu.sessionActive
        text: i18nc("@action:inmenu", "End session")
        icon.name: "media-playback-stop"
        onTriggered: menu.session.endSession()
    }

    OptionalItem {
        id: runItem

        // Running or paused: the chain is open until Stop.
        readonly property bool stops: menu.timer.running || menu.timer.paused

        shown: !menu.pomodoroIdle && !menu.sessionActive
        text: runItem.stops ? i18nc("@action:inmenu", "Stop") : i18nc("@action:inmenu", "Start")
        icon.name: runItem.stops ? "media-playback-stop" : "media-playback-start"
        // Stop while paused discards the chain on the server, so it needs a
        // connection too.
        available: menu.timer.canWrite
        onTriggered: runItem.stops ? menu.timer.stop() : menu.timer.start()
    }

    PlasmaComponents.Menu {
        id: projectMenu

        readonly property bool hasArchived: (menu.timer.running || menu.timer.paused) && menu.timer.entryProject !== null && !menu.timer.entryProject.active
        // Items before the active projects: No project and the archived one.
        readonly property int fixedCount: 1 + (hasArchived ? 1 : 0)

        // A choice is possible: the timer can write, nothing runs, no chain
        // is paused and no session is active.
        readonly property bool choosable: menu.timer.canWrite && !menu.timer.running && !menu.timer.paused && !menu.sessionActive

        popupType: T.Popup.Window
        delegate: PlasmaComponents.MenuItem {}
        enabled: choosable
        title: i18nc("@title:menu current project", "Project: %1", menu.words.projectText)

        ChoiceItem {
            id: noProjectItem
            text: i18nc("@item:inmenu", "No project")
            selected: menu.timer.chosenProjectId === null
            enabled: projectMenu.choosable
            onTriggered: menu.timer.chooseProject(null)
        }

        // The current entry's archived project: shown and checked, never
        // offered for new work.
        Instantiator {
            model: projectMenu.hasArchived ? [menu.timer.entryProject] : []
            delegate: PlasmaComponents.MenuItem {
                required property var modelData

                checkable: true
                checked: true
                enabled: false
                text: menu.words.projectLabel(modelData)
            }
            onObjectAdded: (index, object) => projectMenu.insertItem(1 + index, object)
            onObjectRemoved: (index, object) => projectMenu.removeItem(object)
        }

        // The projects read are fewer than the workspace has: say so and point
        // to the web app. Placed before the projects so a long list does not
        // bury it.
        Instantiator {
            model: menu.timer.projectsIncomplete ? [true] : []
            delegate: PlasmaComponents.MenuItem {
                enabled: false
                text: i18nc("@item:inmenu", "Project list cut short. Use Open Tokkl for the others.")
                Accessible.description: i18nc("@info:whatsthis", "The workspace has more active projects than this menu can list. Open Tokkl in the web app to choose the others.")
            }
            onObjectAdded: (index, object) => projectMenu.insertItem(projectMenu.fixedCount + index, object)
            onObjectRemoved: (index, object) => projectMenu.removeItem(object)
        }

        Instantiator {
            model: menu.timer.projects
            delegate: ChoiceItem {
                required property var modelData

                text: menu.words.projectLabel(modelData)
                selected: menu.timer.chosenProjectId === modelData.id
                enabled: projectMenu.choosable
                onTriggered: menu.timer.chooseProject(modelData.id)
            }
            onObjectAdded: (index, object) => projectMenu.insertItem(projectMenu.fixedCount + (menu.timer.projectsIncomplete ? 1 : 0) + index, object)
            onObjectRemoved: (index, object) => projectMenu.removeItem(object)
        }
    }

    ChoiceItem {
        id: billableItem
        text: i18nc("@option:check", "Billable")
        selected: menu.timer.chosenBillable
        enabled: menu.timer.canWrite && !menu.timer.paused && !menu.sessionActive
        onTriggered: menu.timer.chooseBillable(!menu.timer.chosenBillable)
    }

    ChoiceItem {
        id: modeItem
        text: menu.words.modeText
        selected: menu.words.pomodoroMode
        enabled: menu.session !== null && !menu.session.modeLocked
        onTriggered: menu.session.setPomodoroMode(!menu.session.pomodoroMode)
    }

    PlasmaComponents.MenuSeparator {}

    PlasmaComponents.MenuItem {
        id: reconnectItem
        text: i18nc("@action:inmenu", "Reconnect")
        icon.name: "view-refresh"
        enabled: menu.timer.status !== TokklTimer.Unconfigured
        onTriggered: menu.timer.reconnect()
    }

    PlasmaComponents.MenuItem {
        id: openItem
        text: i18nc("@action:inmenu", "Open Tokkl")
        icon.name: "internet-web-browser"
        enabled: menu.timer.connection !== null && menu.timer.connection.webUrl.toString().length > 0
        onTriggered: menu.openRequested(menu.timer.connection.webUrl)
    }

    PlasmaComponents.MenuItem {
        id: configureItem
        text: i18nc("@action:inmenu", "Configure Tokkl…")
        icon.name: "configure"
        onTriggered: menu.configureRequested()
    }
}
