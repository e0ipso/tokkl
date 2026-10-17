// The project indicator next to the elapsed time, as the KDE panel and the
// macOS menu bar draw it: what to draw for the IndicatorState and
// IndicatorColor properties of org.tokkl.Timer1, and where. indicator.js
// draws it. Nothing here imports from GNOME Shell, so Node runs its tests.
//
// A dot while an entry runs and a still square while stopped. The project
// colour fills the shape inside a ring in the top bar's text colour, which
// keeps the edge at the bar's own text contrast whatever the project colour.
// A project without a valid colour is filled with the text colour. No
// project draws a dashed outline of the shape, and a project still being
// read leaves the slot empty. The slot has the same size in every state, so
// the elapsed time never moves.
//
// Only the running dot's fill pulses, and not while enable-animations is
// off. The ring and the outline never fade. The label names the project,
// so the shape is never the only signal.

import {chosenProjectLabel} from './timer1.js';

// One pulse of the fill, from full opacity down to PULSE_MINIMUM and back,
// as in the web app.
export const PULSE_PERIOD_MS = 1600;
export const PULSE_MINIMUM = 0.35;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * What the indicator shows. state holds the service's properties as the
 * panel button reads them; indicatorState is '' while nothing owns the bus
 * name. enableAnimations is the enable-animations setting of
 * org.gnome.desktop.interface, as GNOME Shell applies it.
 *
 * kind is 'filled' for a known project, 'outline' for no project and
 * 'empty' while the project is still being read or the service is gone.
 * color is the project colour as #rrggbb, or '' for the text colour. label
 * is the project's label, "No project", or '' when the service is gone.
 *
 * @param {{indicatorState: string, indicatorColor: string, running: boolean,
 *          projects: Array<{id: number, name: string, clientName?: string}>,
 *          chosenProject: number}} state
 * @param {boolean} enableAnimations
 * @param {(text: string) => string} _ gettext
 * @returns {{kind: 'filled'|'outline'|'empty', round: boolean, color: string,
 *            pulsing: boolean, label: string}}
 */
export function describeIndicator(state, enableAnimations, _) {
    let kind = 'empty';
    if (state.indicatorState === 'project')
        kind = 'filled';
    else if (state.indicatorState === 'none')
        kind = 'outline';
    const known = kind !== 'empty' || state.indicatorState === 'pending';
    const round = Boolean(state.running);
    return {
        kind,
        round,
        color: kind === 'filled' && HEX_COLOR.test(state.indicatorColor) ? state.indicatorColor.toLowerCase() : '',
        pulsing: kind === 'filled' && round && enableAnimations,
        label: known ? chosenProjectLabel(state.projects, state.chosenProject, _) : '',
    };
}

/**
 * The fill: the project colour, or the text colour without one. Channels
 * are 0 to 255, as St gives the text colour.
 *
 * @param {string} color the indicator's color
 * @param {{red: number, green: number, blue: number}} ink the text colour
 * @returns {{red: number, green: number, blue: number}}
 */
export function fillColor(color, ink) {
    if (!HEX_COLOR.test(color))
        return {red: ink.red, green: ink.green, blue: ink.blue};
    const value = Number.parseInt(color.slice(1), 16);
    return {red: value >> 16 & 0xff, green: value >> 8 & 0xff, blue: value & 0xff};
}

/**
 * Where the shape goes in a slot of width by height pixels: a square of
 * side size at x, y, five eighths of the slot as in the KDE panel. radius
 * is the corner: half the side for the dot, a sixth for the square. line
 * is the width of the ring and the outline and dash the length of the
 * outline's dashes and gaps, one and two pixels at scale 1.
 *
 * @param {number} width
 * @param {number} height
 * @param {boolean} round
 * @param {number} scale St's scale factor
 * @returns {{x: number, y: number, size: number, radius: number, line: number, dash: number}}
 */
export function shapeGeometry(width, height, round, scale) {
    const size = Math.round(Math.min(width, height) * 5 / 8);
    return {
        x: Math.round((width - size) / 2),
        y: Math.round((height - size) / 2),
        size,
        radius: round ? size / 2 : Math.round(size / 6),
        line: scale,
        dash: 2 * scale,
    };
}

/**
 * The fill's opacity elapsedMs into the pulse: 1 at the start of each
 * period, PULSE_MINIMUM half way, on a cosine curve.
 *
 * @param {number} elapsedMs
 * @returns {number}
 */
export function pulseOpacity(elapsedMs) {
    const phase = (elapsedMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    return PULSE_MINIMUM + (1 - PULSE_MINIMUM) * (1 + Math.cos(2 * Math.PI * phase)) / 2;
}
