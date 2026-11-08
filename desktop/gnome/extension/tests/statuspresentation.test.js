// The words the button's time, accessible name and status line show, from
// the Presentation property or, for a service without it, from
// legacyPresentation(), against the fixture the core's test reads too:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { describeTime, legacyPresentation } from '../menumodel.js';
import { describeStatus } from '../timer1.js';

const identity = text => text;
const { cases } = JSON.parse(
    readFileSync(new URL('../../../core/autotests/statuspresentation.json', import.meta.url), 'utf8'),
);
const session = { phase: 'work', plannedEnd: 2000, pomodoroNumber: 2, longRestEvery: 4 };

function timeOf(input) {
    return {
        status: input.status,
        running: false,
        paused: input.paused,
        startTime: 0,
        chainSeconds: 600,
        pomodoroMode: input.pomodoroMode,
        session: input.showsSession ? session : null,
    };
}

function wordsOf(input) {
    return describeStatus(input.status, input.hasDetail ? 'The instance is unreachable' : '', identity);
}

test('a service without Presentation gets the parts of the GNOME policy', () => {
    assert.ok(cases.length > 100);
    for (const { input, gnome } of cases) {
        assert.deepEqual(legacyPresentation(timeOf(input), wordsOf(input)), gnome, JSON.stringify(input));
    }
});

test('the published Presentation and the fallback show the same words', () => {
    for (const { input, gnome } of cases) {
        const time = timeOf(input);
        const words = wordsOf(input);
        assert.deepEqual(
            describeTime({ ...time, presentation: gnome }, words, 'Project Alpha', 1000, identity),
            describeTime(time, words, 'Project Alpha', 1000, identity),
            JSON.stringify(input),
        );
    }
});

test('each part has its words, and a part without any is left out', () => {
    const time = { ...timeOf({ paused: true, pomodoroMode: true, showsSession: false }) };
    const words = describeStatus('stale', 'No network', identity);
    const presentation = {
        summary: ['activity', 'project', 'connection', 'detail', 'pomodoroMode', 'message'],
        menuLine: ['session', 'connection'],
        mark: 'pending',
    };
    assert.deepEqual(describeTime({ ...time, presentation }, words, '', 0, identity), {
        button: '0:10…',
        status: 'Offline, showing the last known state',
        accessibleName: 'Paused 0:10 · Offline, showing the last known state · No network · Pomodoro mode',
    });
});
