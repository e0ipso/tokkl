// The words the button's time, accessible name and status line show, from
// the Presentation property, against the fixture the core's test reads too:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MARKS, describeTime, partTexts } from '../menumodel.js';
import {
    chosenProjectLabel,
    describeStatus,
    formatElapsed,
    phaseName,
    pomodoroModeLabel,
    statusWords,
} from '../timer1.js';

const identity = text => text;
const {
    cases,
    keys,
    words: english,
    elapsed,
} = JSON.parse(readFileSync(new URL('../../../core/autotests/statuspresentation.json', import.meta.url), 'utf8'));
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

// A part, mark or status the core adds without words here fails.
test('every key of the core has words', () => {
    const texts = partTexts(timeOf(cases[0].input), wordsOf(cases[0].input), 'Project Alpha', 1000, identity);
    for (const part of keys.parts) assert.equal(typeof texts[part], 'string', `part ${part}`);
    for (const mark of keys.marks) assert.equal(typeof MARKS[mark], 'string', `mark ${mark}`);
    for (const status of keys.statuses) assert.ok(statusWords(status, '', identity), `status ${status}`);
});

test('without a service the status line is the connection alone, and the time is marked', () => {
    const time = {
        ...timeOf({ status: null, paused: false, pomodoroMode: false, showsSession: false }),
        presentation: null,
    };
    const words = describeStatus(null, '', identity);
    assert.deepEqual(describeTime(time, words, 'No project', 1000, identity), {
        button: '0:10!',
        status: 'Timer service not running',
        accessibleName:
            'Stopped · No project · Timer service not running · Install tokkl-timerd, or check its log with journalctl --user -u tokkl-timerd.',
    });
    const outdated = describeStatus('ready', '', identity, 0);
    assert.equal(describeTime(time, outdated, 'No project', 1000, identity).status, outdated.text);
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

// The English words are the ones every panel shows, as the shared fixture
// lists them; each toolkit translates them on its own.
test('the words are the shared English words', () => {
    assert.deepEqual(Object.keys(english.statuses).sort(), [...keys.statuses].sort());
    for (const [status, text] of Object.entries(english.statuses))
        assert.equal(statusWords(status, '', identity).text, text, status);
    for (const [phase, text] of Object.entries(english.phases)) assert.equal(phaseName(phase, identity), text, phase);
    for (const [kind, text] of Object.entries(english.projectLabels))
        assert.equal(chosenProjectLabel({ kind }, identity), text, kind);
    assert.equal(pomodoroModeLabel(false, identity), english.pomodoroMode);

    const activity = (running, paused) =>
        partTexts(
            { ...timeOf({ paused, pomodoroMode: false, showsSession: false }), running },
            wordsOf({}),
            '',
            0,
            identity,
        ).activity;
    assert.equal(activity(false, false), english.activity.stopped);
    assert.equal(activity(true, false), `${english.activity.running} ${formatElapsed(600)}`);
    assert.equal(activity(false, true), `${english.activity.paused} ${formatElapsed(600)}`);
    assert.equal(partTexts(timeOf(cases[0].input), wordsOf({}), '', 0, identity).pomodoroMode, english.pomodoroMode);
});

test('elapsed time is written as every panel writes it', () => {
    assert.ok(elapsed.length >= 5);
    for (const [seconds, text] of elapsed) assert.equal(formatElapsed(seconds), text, String(seconds));
});
