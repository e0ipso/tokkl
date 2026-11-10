// The ring in the text colour keeps contrast whatever the project colour; the
// slot keeps one size in every state so the elapsed time never moves.

import { chosenProjectLabel } from './timer1.js';

// Matches the web app's pulse.
export const PULSE_PERIOD_MS = 1600;
export const PULSE_MINIMUM = 0.35;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// kind: 'filled' for a project, 'outline' for none, 'empty' while it is read or
// the service is gone. color '' means the text colour.
export function describeIndicator(state, enableAnimations, _) {
    let kind = 'empty';
    if (state.indicatorState === 'project') kind = 'filled';
    else if (state.indicatorState === 'none') kind = 'outline';
    const known = kind !== 'empty' || state.indicatorState === 'pending';
    const round = Boolean(state.running);
    return {
        kind,
        round,
        color: kind === 'filled' && HEX_COLOR.test(state.indicatorColor) ? state.indicatorColor.toLowerCase() : '',
        pulsing: kind === 'filled' && round && enableAnimations,
        label: known ? chosenProjectLabel(state.chosenProjectLabel, _) : '',
    };
}

export function fillColor(color, ink) {
    if (!HEX_COLOR.test(color)) return { red: ink.red, green: ink.green, blue: ink.blue };
    const value = Number.parseInt(color.slice(1), 16);
    return { red: (value >> 16) & 0xff, green: (value >> 8) & 0xff, blue: value & 0xff };
}

// Five eighths of the slot, as in the KDE panel. The ring is one pixel and the
// dashes two at scale 1.
export function shapeGeometry(width, height, round, scale) {
    const size = Math.round((Math.min(width, height) * 5) / 8);
    return {
        x: Math.round((width - size) / 2),
        y: Math.round((height - size) / 2),
        size,
        radius: round ? size / 2 : Math.round(size / 6),
        line: scale,
        dash: 2 * scale,
    };
}

export function pulseOpacity(elapsedMs) {
    const phase = (elapsedMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    return PULSE_MINIMUM + ((1 - PULSE_MINIMUM) * (1 + Math.cos(2 * Math.PI * phase))) / 2;
}
