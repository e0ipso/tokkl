pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Templates as T
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import com.github.e0ipso.tokkl.backend

// The panel item: the Tokkl icon, the project indicator, the elapsed time
// and, unless the timer is ready, a symbol for its state.
//
// Left click, Space or Return pauses a running timer, resumes a paused one
// and starts a stopped one; Stop is in the menu. Right click, the Menu key or
// Shift+F10 opens the menu. Tab focuses the item and a frame shows the focus.
MouseArea {
    id: button

    required property TokklTimer timer

    readonly property alias words: words
    readonly property alias menu: menu

    signal openRequested(url url)
    signal configureRequested

    // Opens the menu with its first enabled entry highlighted, so the
    // keyboard focus is visible at once.
    function openMenuFromKeyboard() {
        menu.popup(button, 0, button.height);
        for (let i = 0; i < menu.count; ++i) {
            const item = menu.itemAt(i);
            if (item instanceof T.MenuItem && item.enabled) {
                menu.currentIndex = i;
                return;
            }
        }
    }

    implicitWidth: row.implicitWidth + 2 * Kirigami.Units.smallSpacing
    implicitHeight: row.implicitHeight
    Layout.minimumWidth: implicitWidth
    Layout.preferredWidth: implicitWidth

    acceptedButtons: Qt.LeftButton | Qt.RightButton
    activeFocusOnTab: true

    onClicked: mouse => {
        if (mouse.button === Qt.RightButton) {
            menu.popup(button, mouse.x, mouse.y);
        } else {
            button.timer.toggle();
        }
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Menu || (event.key === Qt.Key_F10 && (event.modifiers & Qt.ShiftModifier))) {
            button.openMenuFromKeyboard();
            event.accepted = true;
        } else if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Select) {
            button.timer.toggle();
            event.accepted = true;
        }
    }

    Accessible.role: Accessible.Button
    Accessible.name: {
        if (button.timer.running) {
            return i18nc("@action:button", "Pause the Tokkl timer");
        }
        return button.timer.paused ? i18nc("@action:button", "Resume the Tokkl timer") : i18nc("@action:button", "Start the Tokkl timer");
    }
    Accessible.description: words.summary
    Accessible.focusable: true
    Accessible.onPressAction: button.timer.toggle()

    StatusText {
        id: words
        timer: button.timer
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Icon {
            objectName: "logoIcon"
            Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
            Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
            source: Qt.resolvedUrl("../images/tokkl.png")
        }

        ProjectIndicator {
            objectName: "projectIndicator"
            Layout.preferredWidth: implicitWidth
            Layout.preferredHeight: implicitHeight
            timer: button.timer
        }

        PlasmaComponents.Label {
            id: elapsedLabel
            objectName: "elapsedLabel"
            text: button.timer.elapsedText
            font.features: {
                "tnum": 1
            }
        }

        Kirigami.Icon {
            id: stateIcon
            objectName: "stateIcon"
            Layout.preferredWidth: Kirigami.Units.iconSizes.small
            Layout.preferredHeight: Kirigami.Units.iconSizes.small
            visible: button.timer.status !== TokklTimer.Ready
            source: {
                switch (button.timer.status) {
                case TokklTimer.Unconfigured:
                    return "configure";
                case TokklTimer.Loading:
                    return "network-connect";
                case TokklTimer.Busy:
                    return "view-refresh";
                case TokklTimer.Stale:
                    return "network-disconnect";
                case TokklTimer.AuthenticationBlocked:
                    return "dialog-password";
                default:
                    return "dialog-error";
                }
            }
        }
    }

    // The keyboard focus frame.
    Rectangle {
        objectName: "focusFrame"
        anchors.fill: parent
        visible: button.activeFocus
        color: "transparent"
        radius: Kirigami.Units.cornerRadius
        border.width: 2
        border.color: Kirigami.Theme.focusColor
    }

    PanelMenu {
        id: menu
        timer: button.timer
        words: words
        onOpenRequested: url => button.openRequested(url)
        onConfigureRequested: button.configureRequested()
    }
}
