// Tests for projectindicator.js, what the top bar's project indicator shows:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    PULSE_MINIMUM,
    PULSE_PERIOD_MS,
    describeIndicator,
    fillColor,
    pulseOpacity,
    shapeGeometry,
} from '../projectindicator.js';

const identity = text => text;
const projects = [
    {id: 7, name: 'Website', clientName: 'Acme'},
    {id: 9, name: 'Internal', clientName: ''},
];
const timer = overrides => ({
    indicatorState: 'project',
    indicatorColor: '#3366cc',
    running: false,
    projects,
    chosenProject: 7,
    ...overrides,
});

test('a known project fills the shape with its colour and is named', () => {
    assert.deepEqual(describeIndicator(timer({}), true, identity), {
        kind: 'filled',
        round: false,
        color: '#3366cc',
        pulsing: false,
        label: 'Website (Acme)',
    });
});

test('the dot of a running project pulses, and the stopped square does not', () => {
    const running = describeIndicator(timer({running: true}), true, identity);
    assert.equal(running.round, true);
    assert.equal(running.pulsing, true);
    const stopped = describeIndicator(timer({running: false}), true, identity);
    assert.equal(stopped.round, false);
    assert.equal(stopped.pulsing, false);
});

test('nothing pulses while enable-animations is off', () => {
    const shown = describeIndicator(timer({running: true}), false, identity);
    assert.equal(shown.round, true);
    assert.equal(shown.pulsing, false);
});

test('no project is an outline named No project that never pulses', () => {
    const shown = describeIndicator(timer({indicatorState: 'none', indicatorColor: '', chosenProject: 0,
        running: true}), true, identity);
    assert.deepEqual(shown, {kind: 'outline', round: true, color: '', pulsing: false, label: 'No project'});
});

test('a project the instance no longer has is an outline with the menu\'s label', () => {
    const shown = describeIndicator(timer({indicatorState: 'none', indicatorColor: '', chosenProject: 42}),
        true, identity);
    assert.equal(shown.kind, 'outline');
    assert.equal(shown.label, 'Unavailable project');
});

test('a running entry\'s archived project is filled and named from ChosenProjectName', () => {
    const shown = describeIndicator(timer({chosenProject: 42, chosenProjectName: 'Legacy', running: true,
        indicatorColor: '#2da608'}), true, identity);
    assert.deepEqual(shown, {kind: 'filled', round: true, color: '#2da608', pulsing: true, label: 'Legacy'});
});

test('a project still being read leaves the slot empty but keeps the label', () => {
    const shown = describeIndicator(timer({indicatorState: 'pending', indicatorColor: '', running: true}),
        true, identity);
    assert.deepEqual(shown, {kind: 'empty', round: true, color: '', pulsing: false, label: 'Website (Acme)'});
});

test('without the service the slot is empty and unnamed', () => {
    const shown = describeIndicator(timer({indicatorState: '', indicatorColor: '', chosenProject: 0}),
        true, identity);
    assert.equal(shown.kind, 'empty');
    assert.equal(shown.label, '');
});

test('the label goes through gettext', () => {
    const shown = describeIndicator(timer({indicatorState: 'none', chosenProject: 0}), true,
        text => `[${text}]`);
    assert.equal(shown.label, '[No project]');
});

test('a colour that is not #rrggbb fills with the text colour', () => {
    for (const indicatorColor of ['', 'red', '#36c', '#3366cc80', 'javascript:'])
        assert.equal(describeIndicator(timer({indicatorColor}), true, identity).color, '', indicatorColor);
    assert.equal(describeIndicator(timer({indicatorColor: '#3366CC'}), true, identity).color, '#3366cc');
});

test('the fill is the project colour, or the text colour without one', () => {
    const ink = {red: 255, green: 255, blue: 255, alpha: 255};
    assert.deepEqual(fillColor('#3366cc', ink), {red: 0x33, green: 0x66, blue: 0xcc});
    assert.deepEqual(fillColor('', ink), {red: 255, green: 255, blue: 255});
});

test('the shape is five eighths of the slot, centred, with the KDE corners', () => {
    assert.deepEqual(shapeGeometry(16, 16, true, 1), {x: 3, y: 3, size: 10, radius: 5, line: 1, dash: 2});
    assert.deepEqual(shapeGeometry(16, 16, false, 1), {x: 3, y: 3, size: 10, radius: 2, line: 1, dash: 2});
    assert.deepEqual(shapeGeometry(32, 32, false, 2), {x: 6, y: 6, size: 20, radius: 3, line: 2, dash: 4});
    // A slot taller than wide keeps a square shape.
    assert.deepEqual(shapeGeometry(16, 24, false, 1), {x: 3, y: 7, size: 10, radius: 2, line: 1, dash: 2});
});

test('the pulse goes from full opacity to its minimum and back each period', () => {
    assert.equal(pulseOpacity(0), 1);
    assert.ok(Math.abs(pulseOpacity(PULSE_PERIOD_MS / 2) - PULSE_MINIMUM) < 1e-9);
    assert.ok(Math.abs(pulseOpacity(PULSE_PERIOD_MS) - 1) < 1e-9);
    assert.equal(PULSE_PERIOD_MS, 1600);
    assert.equal(PULSE_MINIMUM, 0.35);
    for (let ms = 0; ms <= PULSE_PERIOD_MS; ms += 50) {
        const opacity = pulseOpacity(ms);
        assert.ok(opacity >= PULSE_MINIMUM - 1e-9 && opacity <= 1 + 1e-9, `${ms}: ${opacity}`);
    }
});
