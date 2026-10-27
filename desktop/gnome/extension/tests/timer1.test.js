// Tests for timer1.js, the extension's part that needs no GNOME Shell:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
    AUTH_MODES,
    TIMER1_INTERFACE,
    chosenProjectLabel,
    countdown,
    describeStatus,
    elapsedSeconds,
    formatElapsed,
    nextPhaseLabel,
    phaseName,
    pomodoroModeLabel,
    projectLabel,
    sessionLine,
} from '../timer1.js';

const identity = text => text;

// Every <property>, <method> and <arg> with its attributes, in order.
function members(xml) {
    const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
    return [...withoutComments.matchAll(/<(property|method|arg)\b([^>]*?)\/?>/g)].map(([, tag, attrs]) => {
        const values = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
        return {tag, ...values};
    });
}

test('the interface matches the service description', () => {
    const service = readFileSync(new URL('../../dbus/org.tokkl.Timer1.xml', import.meta.url), 'utf8');
    assert.deepEqual(members(TIMER1_INTERFACE), members(service));
    assert.match(TIMER1_INTERFACE, /<interface name="org\.tokkl\.Timer1">/);
});

test('elapsed time counts from StartTime and is 0 when stopped', () => {
    assert.equal(elapsedSeconds(0, 1_700_000_000), 0);
    assert.equal(elapsedSeconds(1_700_000_000, 1_700_000_065.9), 65);
    // A start slightly ahead of the local clock shows 0, not a negative time.
    assert.equal(elapsedSeconds(1_700_000_010, 1_700_000_000), 0);
});

test('elapsed time is written H:MM in whole minutes', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(59), '0:00');
    assert.equal(formatElapsed(60), '0:01');
    assert.equal(formatElapsed(3599), '0:59');
    assert.equal(formatElapsed(3600), '1:00');
    assert.equal(formatElapsed(3600 + 2 * 60 + 3), '1:02');
    assert.equal(formatElapsed(125 * 3600), '125:00');
    assert.equal(formatElapsed(-5), '0:00');
});

test('every Status value has words and a mark', () => {
    assert.deepEqual(describeStatus('ready', '', identity), {text: 'Connected', detail: '', mark: ''});
    assert.equal(describeStatus('loading', '', identity).mark, '…');
    assert.equal(describeStatus('busy', '', identity).mark, '…');
    for (const status of ['unconfigured', 'stale', 'authentication-blocked', 'error', 'unknown-value', null])
        assert.equal(describeStatus(status, 'why', identity).mark, '!', String(status));
    assert.equal(describeStatus('stale', 'Network down', identity).detail, 'Network down');
    assert.equal(describeStatus('error', 'Server said no', identity).detail, 'Server said no');
    assert.match(describeStatus(null, '', identity).text, /not running/);
    assert.match(describeStatus('unconfigured', '', identity).detail, /settings/);
});

test('project labels name the client, an archived project and the missing project', () => {
    const projects = [
        {id: 7, name: 'Website', clientName: 'Acme'},
        {id: 9, name: 'Internal', clientName: ''},
    ];
    assert.equal(projectLabel(projects[0]), 'Website (Acme)');
    assert.equal(projectLabel(projects[1]), 'Internal');
    assert.equal(chosenProjectLabel(projects, 0, '', identity), 'No project');
    assert.equal(chosenProjectLabel(projects, 9, 'Internal', identity), 'Internal');
    assert.equal(chosenProjectLabel(projects, 7, 'Website', identity), 'Website (Acme)');
    // A running entry's archived project is not in Projects but has a name.
    assert.equal(chosenProjectLabel(projects, 42, 'Legacy', identity), 'Legacy');
    assert.equal(chosenProjectLabel(projects, 42, '', identity), 'Unavailable project');
});

test('the countdown rounds the time left up and the overtime down', () => {
    const end = 1_700_001_500;
    assert.deepEqual(countdown(end, end - 1500), {text: '25:00', overtime: false});
    assert.deepEqual(countdown(end, end - 1499.2), {text: '25:00', overtime: false});
    assert.deepEqual(countdown(end, end - 0.001), {text: '0:01', overtime: false});
    // The planned end itself is the first instant of overtime.
    assert.deepEqual(countdown(end, end), {text: '+0:00', overtime: true});
    assert.deepEqual(countdown(end, end + 0.999), {text: '+0:00', overtime: true});
    assert.deepEqual(countdown(end, end + 61.5), {text: '+1:01', overtime: true});
});

test('the countdown writes minutes past an hour without wrapping them', () => {
    assert.equal(countdown(1_700_010_800, 1_700_000_000).text, '180:00');
    assert.equal(countdown(1_700_000_000, 1_700_000_000 + 75 * 60 + 9).text, '+75:09');
});

test('phases are named Work, Short rest and Long rest', () => {
    assert.equal(phaseName('work', identity), 'Work');
    assert.equal(phaseName('shortRest', identity), 'Short rest');
    assert.equal(phaseName('longRest', identity), 'Long rest');
    assert.equal(phaseName('', identity), '');
    assert.equal(phaseName('nap', identity), '');
});

test('the session line names the phase, the time left or the overtime, and the pomodoro', () => {
    const session = {phase: 'shortRest', plannedEnd: 1_700_000_250, pomodoroNumber: 2, longRestEvery: 4};
    assert.equal(sessionLine(session, 1_700_000_000, identity), 'Short rest · 4:10 left · Pomodoro 2 of 4');
    assert.equal(sessionLine({...session, phase: 'work', pomodoroNumber: 3}, 1_700_000_312, identity),
        'Work · +1:02 overtime · Pomodoro 3 of 4');
});

test('the session items name the next phase and the mode lock', () => {
    assert.equal(nextPhaseLabel('longRest', identity), 'Next phase: Long rest');
    assert.equal(nextPhaseLabel('work', identity), 'Next phase: Work');
    assert.equal(pomodoroModeLabel(false, identity), 'Pomodoro mode');
    assert.equal(pomodoroModeLabel(true, identity), 'Pomodoro mode (locked while running)');
});

test('the sign-in methods are the ones Configure accepts', () => {
    assert.deepEqual(AUTH_MODES, ['token', 'password']);
});
