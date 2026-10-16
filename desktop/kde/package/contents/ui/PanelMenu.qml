pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Templates as T
import org.kde.plasma.components as PlasmaComponents

import com.github.e0ipso.tokkl.backend

// The panel item's menu: state, Project, Billable, Reconnect, Open Tokkl and
// Configure. Arrow keys move, Right opens Project, Return or Space triggers
// and Escape closes.
//
// Project and Billable change the choices for the next start and, while an
// entry runs, that whole entry in place. They are disabled whenever the
// timer cannot write, so nothing is queued for another account.
PlasmaComponents.Menu {
    id: menu

    required property TokklTimer timer
    required property StatusText words

    property alias stateItem: stateItem
    property alias projectMenu: projectMenu
    property alias noProjectItem: noProjectItem
    property alias billableItem: billableItem
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
        text: i18nc("@item:inmenu running state, elapsed time, connection state", "%1 %2 · %3", menu.words.runText, menu.timer.elapsedText, menu.words.statusText)
        Accessible.description: menu.words.detailText
    }

    PlasmaComponents.Menu {
        id: projectMenu

        readonly property bool hasArchived: menu.timer.running && menu.timer.entryProject !== null && !menu.timer.entryProject.active
        // Items before the active projects: No project and the archived one.
        readonly property int fixedCount: 1 + (hasArchived ? 1 : 0)

        popupType: T.Popup.Window
        delegate: PlasmaComponents.MenuItem {}
        enabled: menu.timer.canWrite
        title: i18nc("@title:menu current project", "Project: %1", menu.words.projectText)

        ChoiceItem {
            id: noProjectItem
            text: i18nc("@item:inmenu", "No project")
            selected: menu.timer.chosenProjectId === null
            enabled: menu.timer.canWrite
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
                enabled: menu.timer.canWrite
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
        enabled: menu.timer.canWrite
        onTriggered: menu.timer.chooseBillable(!menu.timer.chosenBillable)
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
