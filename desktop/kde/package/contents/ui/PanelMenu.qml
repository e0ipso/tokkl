pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Templates as T
import org.kde.plasma.components as PlasmaComponents

import com.canpicasoft.tokkl.backend

// The panel item's menu: state, the session's message, Start session, Next
// phase, End session, Start or Stop, Project, Billable, Pomodoro mode,
// Reconnect, Open Tokkl and Configure. Arrow keys move, Right opens Project,
// Return or Space triggers and Escape closes. A hidden entry is disabled too,
// so the arrow keys skip it.
//
// Which of Start or Stop, Start session, Next phase, End session, Project,
// Billable and Pomodoro mode show and can be chosen comes from the core's
// rules (TokklMenuActions, MenuActionStates in desktop/core), with the KDE
// policy: writes wait for canWrite. The timer's rule disables Project and
// Billable during a session, as neither reaches the open pomodoro. The
// session is the server's, so Next phase and End session show whenever one
// is active, in either mode and whichever device started it, and the state
// line then names the phase.
//
// Stop ends the timer and its pause chain; while paused it asks the server
// to discard the chain. Project sets only the project of the next start;
// changing the project of a running entry means stopping and starting a new
// entry. Billable sets the next start too and, while an entry runs, edits
// that entry in place.
PlasmaComponents.Menu {
    id: menu

    required property TokklTimer timer
    // Null until the backend has built it, which reads as Timer mode.
    property TokklPomodoroSession session: null
    required property StatusText words

    // The core's states of the timer and session actions: visible, enabled
    // and label for each.
    readonly property TokklMenuActions menuActions: TokklMenuActions {
        timer: menu.timer
        session: menu.session
    }
    readonly property var actionStates: menu.menuActions.states

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

    // An action as the core's state describes it.
    component ActionItem: OptionalItem {
        required property var actionState

        shown: actionState.visible
        available: actionState.enabled
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
        text: menu.words.menuLine
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

    ActionItem {
        id: startSessionItem
        actionState: menu.actionStates.startSession
        text: i18nc("@action:inmenu", "Start session")
        icon.name: "media-playback-start"
        onTriggered: menu.session.startSession()
    }

    ActionItem {
        id: nextPhaseItem
        actionState: menu.actionStates.nextPhase
        text: menu.words.nextPhaseText
        icon.name: "media-skip-forward"
        onTriggered: menu.session.confirmNextPhase()
    }

    ActionItem {
        id: endSessionItem
        actionState: menu.actionStates.endSession
        text: i18nc("@action:inmenu", "End session")
        icon.name: "media-playback-stop"
        onTriggered: menu.session.endSession()
    }

    ActionItem {
        id: runItem

        // Running or paused: the chain is open until Stop.
        readonly property bool stops: runItem.actionState.label === "stop"

        actionState: menu.actionStates.run
        text: runItem.stops ? i18nc("@action:inmenu", "Stop") : i18nc("@action:inmenu", "Start")
        icon.name: runItem.stops ? "media-playback-stop" : "media-playback-start"
        onTriggered: runItem.stops ? menu.timer.stop() : menu.timer.start()
    }

    PlasmaComponents.Menu {
        id: projectMenu

        // The rows after No project, in the order the core gives them: the
        // current entry's archived project, a note when the list is cut
        // short, then the active projects. Row i is item 1 + i of the menu.
        readonly property var rows: menu.timer.projectChoices

        // A choice is possible: the timer can write, nothing runs, no chain
        // is paused and no session is active.
        readonly property bool choosable: menu.actionStates.project.enabled

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

        // The archived project is shown and checked, never offered for new
        // work. The note says the projects read are fewer than the workspace
        // has and points to the web app; it comes before the projects so a
        // long list does not bury it.
        Instantiator {
            model: projectMenu.rows
            delegate: ChoiceItem {
                required property var modelData
                readonly property bool isNote: modelData.kind === "incomplete"
                readonly property bool isProject: modelData.kind === "project"

                checkable: !isNote
                selected: modelData.kind === "archived" || (isProject && menu.timer.chosenProjectId === modelData.project.id)
                enabled: isProject && projectMenu.choosable
                text: isNote ? i18nc("@item:inmenu", "Project list cut short. Use Open Tokkl for the others.") : menu.words.projectLabel(modelData.project)
                Accessible.description: isNote ? i18nc("@info:whatsthis", "The workspace has more active projects than this menu can list. Open Tokkl in the web app to choose the others.") : ""
                onTriggered: {
                    if (isProject) {
                        menu.timer.chooseProject(modelData.project.id);
                    }
                }
            }
            onObjectAdded: (index, object) => projectMenu.insertItem(1 + index, object)
            onObjectRemoved: (index, object) => projectMenu.removeItem(object)
        }
    }

    ChoiceItem {
        id: billableItem
        text: i18nc("@option:check", "Billable")
        selected: menu.timer.chosenBillable
        enabled: menu.actionStates.billable.enabled
        onTriggered: menu.timer.chooseBillable(!menu.timer.chosenBillable)
    }

    ChoiceItem {
        id: modeItem
        text: menu.words.modeText
        selected: menu.words.pomodoroMode
        enabled: menu.actionStates.mode.enabled
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
