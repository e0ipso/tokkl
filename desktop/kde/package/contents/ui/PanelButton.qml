pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Templates as T
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

import com.canpicasoft.tokkl.backend

// The panel item: the Tokkl icon, the hourglass in Pomodoro mode, the
// project indicator, the elapsed time (the session's countdown during a
// session) and, unless the timer is ready, a symbol for its state.
//
// Left click, Space or Return pause a running timer and resume a paused one,
// in either mode. In Timer mode they start a stopped timer; Stop is in the
// menu. In Pomodoro mode they start a session. Whenever a session is active,
// in either mode and whichever device started it, they confirm Next phase
// while the alarm rings and otherwise open the menu. Right click, the Menu
// key or Shift+F10 opens the menu. Tab focuses the item and a frame shows the
// focus.
MouseArea {
    id: button

    required property TokklTimer timer
    // Null until the backend has built it; the timer alone then takes the
    // click, as in Timer mode.
    property TokklPomodoroSession session: null
    property bool monochromeIcon: false
    readonly property color panelInk: Kirigami.Theme.textColor
    readonly property bool lightPanelInk: panelInk.r * 0.2126 + panelInk.g * 0.7152 + panelInk.b * 0.0722 > 0.5

    readonly property alias words: words
    readonly property alias menu: menu

    signal openRequested(url url)
    signal configureRequested

    // The left click, Space, Return and the press action. Returns true when
    // the session asks for the menu instead.
    function activate(): bool {
        if (button.session === null) {
            button.timer.toggle();
            return false;
        }
        return button.session.activate() === TokklPomodoroSession.OpenMenu;
    }

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
        } else if (button.activate()) {
            menu.popup(button, mouse.x, mouse.y);
        }
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Menu || (event.key === Qt.Key_F10 && (event.modifiers & Qt.ShiftModifier))) {
            button.openMenuFromKeyboard();
            event.accepted = true;
        } else if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Select) {
            if (button.activate()) {
                button.openMenuFromKeyboard();
            }
            event.accepted = true;
        }
    }

    Accessible.role: Accessible.Button
    Accessible.name: {
        if (words.showsSession) {
            return words.sessionText;
        }
        if (button.timer.running) {
            return words.withMode(i18nc("@action:button", "Pause the Tokkl timer"));
        }
        if (button.timer.paused) {
            return words.withMode(i18nc("@action:button", "Resume the Tokkl timer"));
        }
        return words.pomodoroMode ? words.withMode(i18nc("@action:button", "Start a Pomodoro session")) : i18nc("@action:button", "Start the Tokkl timer");
    }
    // The session's line has no project, so the description names it.
    Accessible.description: words.showsSession ? words.withMessage(words.projectText) : words.summary
    Accessible.focusable: true
    Accessible.onPressAction: {
        if (button.activate()) {
            button.openMenuFromKeyboard();
        }
    }

    StatusText {
        id: words
        timer: button.timer
        session: button.session
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Icon {
            objectName: "logoIcon"
            Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
            Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
            source: Qt.resolvedUrl(button.monochromeIcon
                ? (button.lightPanelInk ? "../images/tokkl-mono-light.png" : "../images/tokkl-mono-dark.png")
                : "../images/tokkl.png")
            isMask: button.monochromeIcon
            color: button.monochromeIcon ? button.panelInk : "transparent"
        }

        // Pomodoro mode: the hourglass, tinted like the logo when monochrome.
        Kirigami.Icon {
            objectName: "pomodoroGlyph"
            Layout.preferredWidth: Kirigami.Units.iconSizes.small
            Layout.preferredHeight: Kirigami.Units.iconSizes.small
            visible: words.pomodoroMode
            source: Qt.resolvedUrl(button.monochromeIcon ? "../images/hourglass-mono.svg" : "../images/hourglass.svg")
            isMask: button.monochromeIcon
            color: button.monochromeIcon ? button.panelInk : "transparent"
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
            text: words.showsSession ? button.session.countdownText : button.timer.elapsedText
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
        session: button.session
        words: words
        onOpenRequested: url => button.openRequested(url)
        onConfigureRequested: button.configureRequested()
    }
}
