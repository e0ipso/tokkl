// The project indicator's drawing on the panel button. projectindicator.js
// decides what it shows; this widget only paints that.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { fillColor, pulseOpacity, PULSE_PERIOD_MS, shapeGeometry } from './projectindicator.js';

// The project indicator in a slot of its own; projectindicator.js decides
// what it shows. Two drawing areas share the slot, so the fill can pulse
// while the ring or outline above it keeps full opacity.
export const TokklProjectIndicator = GObject.registerClass(
    class TokklProjectIndicator extends St.Widget {
        _init() {
            super._init({
                style_class: 'tokkl-project-indicator',
                layout_manager: new Clutter.BinLayout(),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._shape = { kind: 'empty', round: false, color: '', pulsing: false, label: '' };
            this._pulse = null;

            this._fill = new St.DrawingArea({ x_expand: true, y_expand: true, visible: false });
            this._fill.connect('repaint', area => this._paint(area, true));
            this.add_child(this._fill);
            this._edge = new St.DrawingArea({ x_expand: true, y_expand: true, visible: false });
            this._edge.connect('repaint', area => this._paint(area, false));
            this.add_child(this._edge);

            this.connect('style-changed', () => this._repaint());
            this.connect('destroy', () => this._stopPulse());
        }

        get shape() {
            return this._shape;
        }

        /**
         * @param {ReturnType<typeof describeIndicator>} shape
         */
        setShape(shape) {
            this._shape = shape;
            this.accessible_name = shape.label;
            this._fill.visible = shape.kind === 'filled';
            this._edge.visible = shape.kind !== 'empty';
            this._repaint();
            if (shape.pulsing && !this._pulse) this._startPulse();
            else if (!shape.pulsing) this._stopPulse();
        }

        _repaint() {
            this._fill.queue_repaint();
            this._edge.queue_repaint();
        }

        // The timeline follows the fill's frame clock, so it does not advance
        // while the top bar is not on screen.
        _startPulse() {
            this._pulse = new Clutter.Timeline({ actor: this._fill, duration: PULSE_PERIOD_MS, repeat_count: -1 });
            this._pulse.connect('new-frame', (timeline, elapsedMs) => {
                this._fill.opacity = Math.round(255 * pulseOpacity(elapsedMs));
            });
            this._pulse.start();
        }

        _stopPulse() {
            this._pulse?.stop();
            this._pulse = null;
            this._fill.opacity = 255;
        }

        // The ring, the outline and a fill without a project colour take the
        // top bar's text colour.
        _paint(area, fill) {
            const cr = area.get_context();
            const [width, height] = area.get_surface_size();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const { x, y, size, radius, line, dash } = shapeGeometry(width, height, this._shape.round, scale);
            const ink = area.get_theme_node().get_foreground_color();

            if (fill) {
                const { red, green, blue } = fillColor(this._shape.color, ink);
                cr.setSourceRGB(red / 255, green / 255, blue / 255);
                shapePath(cr, x, y, size, radius);
                cr.fill();
            } else {
                cr.setSourceRGBA(ink.red / 255, ink.green / 255, ink.blue / 255, ink.alpha / 255);
                cr.setLineWidth(line);
                if (this._shape.kind === 'outline') cr.setDash([dash, dash], 0);
                // The stroke stays inside the shape, as a border would.
                shapePath(cr, x + line / 2, y + line / 2, size - line, Math.max(0, radius - line / 2));
                cr.stroke();
            }
            cr.$dispose();
        }
    },
);

function shapePath(cr, x, y, size, radius) {
    cr.newSubPath();
    cr.arc(x + size - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + size - radius, y + size - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + size - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
    cr.closePath();
}
