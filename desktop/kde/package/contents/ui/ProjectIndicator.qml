pragma ComponentBehavior: Bound

import QtQuick
import org.kde.kirigami as Kirigami

import com.github.e0ipso.tokkl.backend

// The project of the running entry, or of the next start while stopped, as a
// small shape in the panel row. A dot pulses while an entry runs and a still
// square shows while stopped. The project colour fills the shape inside a
// ring in the theme text colour, which keeps 3:1 against the panel in light
// and dark themes whatever the project colour. Only the fill pulses; the ring
// and the dashed outline stay at full opacity, so the edge never fades. A project without a valid
// colour is filled with the text colour. No project draws a dashed outline of
// the shape, and a project still being read leaves the slot empty. The slot
// has the same width in every state, so the row never changes size.
//
// The shape is decoration: StatusText names the project in the tooltip and
// the accessible description, so nothing depends on colour.
Item {
    id: indicator

    required property TokklTimer timer

    // Reduced motion follows Plasma's Animation speed setting, which stores
    // AnimationDurationFactor in kdeglobals; "Instant" is 0. The KDE Kirigami
    // platform plugins scale Units by it, but at 0 longDuration is 1, not 0,
    // with Kirigami 6.24 (shortDuration is 0). Plasma's own BusyIndicator
    // stops its motion when longDuration <= 1, and so does this.
    readonly property bool reducedMotion: Kirigami.Units.longDuration <= 1

    readonly property bool filled: timer.indicatorState === TokklTimer.IndicatorState.Project
    readonly property bool dashed: timer.indicatorState === TokklTimer.IndicatorState.None
    readonly property bool round: timer.running
    readonly property color fillColor: timer.indicatorColor.valid ? timer.indicatorColor : Kirigami.Theme.textColor
    readonly property color ringColor: Kirigami.Theme.textColor
    readonly property bool pulsing: pulse.running
    readonly property alias fillOpacity: fill.opacity
    // As Plasma's BusyIndicator: no motion for a hidden item or window.
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

    // The pulse of the running dot's fill: the web app's 1.6 s cycle down to
    // 0.35 opacity and back. Under reduced motion, or while hidden, it stops
    // at full opacity.
    SequentialAnimation {
        id: pulse
        running: indicator.round && indicator.filled && indicator.shown && !indicator.reducedMotion
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
