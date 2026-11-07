// Tests for menumodel.js, what the panel button and menu show:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeMenu, describeTime, projectChoices } from '../menumodel.js';
import { describeStatus, projectLabel } from '../timer1.js';

const identity = text => text;

function serviceState(overrides = {}) {
    return {
        status: 'ready',
        running: false,
        paused: false,
        projects: [{ id: 7, name: 'Alpha', clientName: 'Acme' }],
        chosenProject: 0,
        chosenProjectName: '',
        billable: false,
        pomodoroMode: false,
        modeLocked: false,
        sessionActive: false,
        canStartSession: false,
        upcomingPhase: '',
        sessionMessage: '',
        ...overrides,
    };
}

function menuFor(overrides) {
    const state = serviceState(overrides);
    return describeMenu(state, describeStatus(state.status, '', identity), identity);
}

test('a stopped timer offers Start and an open project choice', () => {
    const menu = menuFor();
    assert.deepEqual(menu.toggle, { text: 'Start', sensitive: true, visible: true });
    assert.deepEqual(menu.project, { text: 'Project: No project', sensitive: true });
    assert.deepEqual(menu.billable, { checked: false, sensitive: true });
    assert.equal(menu.startSession.visible, false);
    assert.equal(menu.nextPhase.visible, false);
    assert.equal(menu.message.visible, false);
});

test('a running entry locks the project but not billable', () => {
    const menu = menuFor({ running: true, chosenProject: 7, billable: true });
    assert.equal(menu.toggle.text, 'Stop');
    assert.deepEqual(menu.project, { text: 'Project: Alpha (Acme) (locked while running)', sensitive: false });
    assert.deepEqual(menu.billable, { checked: true, sensitive: true });
});

test('a paused chain locks the project and billable and offers Stop', () => {
    const menu = menuFor({ paused: true });
    assert.equal(menu.toggle.text, 'Stop');
    assert.equal(menu.project.text, 'Project: No project (locked while paused)');
    assert.equal(menu.project.sensitive, false);
    assert.equal(menu.billable.sensitive, false);
});

test('Pomodoro mode hides Start and offers a session the service allows', () => {
    const menu = menuFor({ pomodoroMode: true, canStartSession: true });
    assert.equal(menu.toggle.visible, false);
    assert.deepEqual(menu.startSession, { visible: true, sensitive: true });
    assert.deepEqual(menu.mode, { text: 'Pomodoro mode', checked: true, sensitive: true });
    // A timer still held in Pomodoro mode keeps its Stop.
    assert.equal(menuFor({ pomodoroMode: true, paused: true }).toggle.visible, true);
});

test('an active session shows its own items in either mode', () => {
    for (const pomodoroMode of [false, true]) {
        const menu = menuFor({ pomodoroMode, sessionActive: true, upcomingPhase: 'shortRest', modeLocked: true });
        assert.equal(menu.toggle.visible, false);
        assert.equal(menu.startSession.visible, false);
        assert.deepEqual(menu.nextPhase, { text: 'Next phase: Short rest', visible: true });
        assert.deepEqual(menu.endSession, { visible: true });
        assert.equal(menu.mode.text, 'Pomodoro mode (locked while running)');
        assert.equal(menu.mode.sensitive, false);
    }
});

test('nothing can be chosen without a ready service', () => {
    const menu = menuFor({ status: null });
    assert.equal(menu.toggle.sensitive, false);
    assert.equal(menu.project.sensitive, false);
    assert.equal(menu.billable.sensitive, false);
    assert.equal(menu.mode.sensitive, false);
    assert.deepEqual(menu.detail, {
        text: 'Install tokkl-timerd, or check its log with journalctl --user -u tokkl-timerd.',
        visible: true,
    });
});

test('the session message shows while there is one', () => {
    assert.deepEqual(menuFor({ sessionMessage: 'Too short to save' }).message, {
        text: 'Too short to save',
        visible: true,
    });
});

test('the project choices start with No project and check the chosen one', () => {
    assert.deepEqual(
        projectChoices(
            [
                { id: 7, name: 'Alpha' },
                { id: 9, name: 'Beta', clientName: 'Acme' },
            ],
            9,
            projectLabel,
            identity,
        ),
        [
            { id: 0, label: 'No project', checked: false },
            { id: 7, label: 'Alpha', checked: false },
            { id: 9, label: 'Beta (Acme)', checked: true },
        ],
    );
});

const ready = describeStatus('ready', '', identity);
const stopped = { running: false, paused: false, startTime: 0, chainSeconds: 0, pomodoroMode: false, session: null };

test('a running chain shows its total on the button and in the name', () => {
    const time = { ...stopped, running: true, startTime: 1000, chainSeconds: 600 };
    assert.deepEqual(describeTime(time, ready, 'Project Alpha', 1000 + 125, identity), {
        button: '0:12',
        status: 'Connected',
        accessibleName: 'Running 0:12 · Project Alpha · Connected',
    });
});

test('a paused chain leads the status line with its total', () => {
    const time = { ...stopped, paused: true, chainSeconds: 3660 };
    const shown = describeTime(time, ready, '', 5000, identity);
    assert.equal(shown.button, '1:01');
    assert.equal(shown.status, 'Paused 1:01 · Connected');
    assert.equal(shown.accessibleName, 'Paused 1:01 · Connected');
});

test('a stopped timer names the status, its detail and Pomodoro mode', () => {
    const offline = describeStatus('stale', 'No network', identity);
    const shown = describeTime({ ...stopped, pomodoroMode: true }, offline, '', 0, identity);
    assert.equal(shown.button, '0:00!');
    assert.equal(shown.accessibleName, 'Stopped · Offline, showing the last known state · No network · Pomodoro mode');
});

test('a session counts its phase down instead', () => {
    const session = { phase: 'work', plannedEnd: 2000, pomodoroNumber: 2, longRestEvery: 4 };
    const shown = describeTime({ ...stopped, pomodoroMode: true, session }, ready, '', 2000 - 90, identity);
    assert.equal(shown.button, '1:30');
    assert.equal(shown.status, 'Work · 1:30 left · Pomodoro 2 of 4');
    assert.equal(shown.accessibleName, 'Work · 1:30 left · Pomodoro 2 of 4 · Connected');
});
