pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Templates as T
import org.kde.plasma.components as PlasmaComponents

import com.canpicasoft.tokkl.backend

// Which actions show and can be chosen comes from the core's MenuActions;
// the KDE policy adds that writes wait for canWrite.
PlasmaComponents.Menu {
    id: menu

    required property TokklTimer timer
    // Null reads as Timer mode.
    property TokklPomodoroSession session: null
    required property StatusText words

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

    // Otherwise the panel clips the menu.
    popupType: T.Popup.Window

    // Projects have no stream, so each opening refreshes them.
    onAboutToShow: menu.timer.refreshProjects()
    // Plasma's own delegate binds to its parent before it has one.
    delegate: PlasmaComponents.MenuItem {}

    // A click asks the controller instead of flipping the check mark.
    component ChoiceItem: PlasmaComponents.MenuItem {
        required property bool selected

        checkable: true
        checked: selected
        onToggled: checked = Qt.binding(() => selected)
    }

    // Hidden also means disabled, so the arrow keys skip it.
    component OptionalItem: PlasmaComponents.MenuItem {
        required property bool shown
        property bool available: true

        visible: shown
        enabled: shown && available
        height: shown ? implicitHeight : 0
    }

    component ActionItem: OptionalItem {
        required property var actionState

        shown: actionState.visible
        available: actionState.enabled
    }

    // Close on a new instance, account or secret, so no choice made for the
    // previous one can fire.
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

        readonly property bool stops: runItem.actionState.label === "stop"

        actionState: menu.actionStates.run
        text: runItem.stops ? i18nc("@action:inmenu", "Stop") : i18nc("@action:inmenu", "Start")
        icon.name: runItem.stops ? "media-playback-stop" : "media-playback-start"
        onTriggered: runItem.stops ? menu.timer.stop() : menu.timer.start()
    }

    PlasmaComponents.Menu {
        id: projectMenu

        // Row i is menu item 1 + i, after No project.
        readonly property var rows: menu.timer.projectChoices

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

        Instantiator {
            model: projectMenu.rows
            delegate: ChoiceItem {
                required property var modelData
                readonly property bool isNote: modelData.kind === "incomplete"
                readonly property bool isProject: modelData.kind === "project"

                checkable: !isNote
                selected: modelData.kind === "archived" || (isProject && menu.timer.chosenProjectId === modelData.project.id)
                enabled: isProject && projectMenu.choosable
                text: isNote ? i18nc("@item:inmenu", "Project list cut short. Use Open Tokkl for the others.") : menu.words.projectLabel(modelData.label)
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
