pragma ComponentBehavior: Bound

import QtQuick
import org.kde.kirigami as Kirigami

import com.canpicasoft.tokkl.backend

// The text-colour ring keeps 3:1 contrast in light and dark themes whatever
// the project colour; only the fill pulses, so the edge never fades.
Item {
    id: indicator

    required property TokklTimer timer

    // With "Instant" animations Kirigami 6.24 sets longDuration to 1, not 0;
    // Plasma's BusyIndicator uses the same <= 1 test.
    readonly property bool reducedMotion: Kirigami.Units.longDuration <= 1

    readonly property bool filled: timer.indicatorState === TokklTimer.IndicatorState.Project
    readonly property bool dashed: timer.indicatorState === TokklTimer.IndicatorState.None
    readonly property bool round: timer.running || timer.paused
    readonly property color fillColor: timer.indicatorColor !== "" ? timer.indicatorColor : Kirigami.Theme.textColor
    readonly property color ringColor: Kirigami.Theme.textColor
    readonly property bool pulsing: pulse.running
    readonly property alias fillOpacity: fill.opacity
    // As Plasma's BusyIndicator.
    readonly property bool shown: visible && Window.visibility !== Window.Hidden

    readonly property int shapeSize: Math.round(Kirigami.Units.iconSizes.small * 5 / 8)

    implicitWidth: Kirigami.Units.iconSizes.small
    implicitHeight: Kirigami.Units.iconSizes.small

    Accessible.ignored: true

    Item {
        objectName: "indicatorShape"
        width: indicator.shapeSize
        height: indicator.shapeSize
        x: Math.round((indicator.width - width) / 2)
        y: Math.round((indicator.height - height) / 2)

        Rectangle {
            id: fill
            objectName: "indicatorFill"
            anchors.fill: parent
            visible: indicator.filled
            radius: ring.radius
            color: indicator.fillColor
        }

        Rectangle {
            id: ring
            objectName: "indicatorRing"
            anchors.fill: parent
            visible: indicator.filled
            radius: indicator.round ? width / 2 : Math.round(width / 6)
            color: "transparent"
            border.width: 1
            border.color: indicator.ringColor
        }

        Canvas {
            id: outline
            objectName: "indicatorOutline"
            anchors.fill: parent
            visible: indicator.dashed

            readonly property bool round: indicator.round
            readonly property color strokeColor: indicator.ringColor

            onRoundChanged: requestPaint()
            onStrokeColorChanged: requestPaint()
            onWidthChanged: requestPaint()
            onHeightChanged: requestPaint()

            onPaint: {
                const ctx = getContext("2d");
                ctx.reset();
                ctx.strokeStyle = outline.strokeColor;
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                if (outline.round) {
                    ctx.arc(width / 2, height / 2, width / 2 - 0.5, 0, 2 * Math.PI);
                } else {
                    ctx.rect(0.5, 0.5, width - 1, height - 1);
                }
                ctx.stroke();
            }
        }
    }

    // Matches the web app's 1.6 s pulse.
    SequentialAnimation {
        id: pulse
        running: indicator.timer.running && indicator.filled && indicator.shown && !indicator.reducedMotion
        loops: Animation.Infinite

        NumberAnimation {
            target: fill
            property: "opacity"
            to: 0.35
            duration: 800
            easing.type: Easing.InOutSine
        }
        NumberAnimation {
            target: fill
            property: "opacity"
            to: 1
            duration: 800
            easing.type: Easing.InOutSine
        }

        onRunningChanged: {
            if (!running) {
                fill.opacity = 1;
            }
        }
    }
}
