// Tests for menumodel.js, what the panel button and menu show:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeMenu, describeTime, projectChoices } from '../menumodel.js';
import { describeStatus, projectLabel } from '../timer1.js';

const identity = text => text;

// The Actions property as tokkl-timerd publishes it for a stopped, ready
// timer in Timer mode, with some actions replaced.
function actions(overrides = {}) {
    return {
        run: { visible: true, enabled: true, label: 'start' },
        startSession: { visible: false, enabled: false, label: 'startSession' },
        nextPhase: { visible: false, enabled: false, label: '' },
        endSession: { visible: false, enabled: false, label: 'endSession' },
        project: { visible: true, enabled: true, label: 'project' },
        billable: { visible: true, enabled: true, label: 'billable' },
        mode: { visible: true, enabled: true, label: 'pomodoroMode' },
        ...overrides,
    };
}

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
        actions: actions(),
        ...overrides,
    };
}

function menuFor(overrides) {
    const state = serviceState(overrides);
    return describeMenu(state, describeStatus(state.status, '', identity), identity);
}

test('the menu shows what Actions says', () => {
    const menu = menuFor();
    assert.deepEqual(menu.toggle, { text: 'Start', sensitive: true, visible: true });
    assert.deepEqual(menu.project, { text: 'Project: No project', sensitive: true });
    assert.deepEqual(menu.billable, { checked: false, sensitive: true });
    assert.deepEqual(menu.startSession, { visible: false, sensitive: false });
    assert.equal(menu.nextPhase.visible, false);
    assert.equal(menu.message.visible, false);

    const held = menuFor({
        actions: actions({
            run: { visible: true, enabled: false, label: 'stop' },
            project: { visible: true, enabled: false, label: 'project' },
            billable: { visible: true, enabled: false, label: 'billable' },
        }),
    });
    assert.deepEqual(held.toggle, { text: 'Stop', sensitive: false, visible: true });
    assert.equal(held.project.sensitive, false);
    assert.equal(held.billable.sensitive, false);
});

test('a project locked by a running or paused entry says why', () => {
    const running = menuFor({
        chosenProject: 7,
        billable: true,
        actions: actions({ project: { visible: true, enabled: false, label: 'projectRunning' } }),
    });
    assert.deepEqual(running.project, { text: 'Project: Alpha (Acme) (locked while running)', sensitive: false });
    assert.deepEqual(running.billable, { checked: true, sensitive: true });
    const paused = menuFor({
        actions: actions({ project: { visible: true, enabled: false, label: 'projectPaused' } }),
    });
    assert.equal(paused.project.text, 'Project: No project (locked while paused)');
});

test('Start session shows and can be chosen as Actions says', () => {
    const menu = menuFor({
        pomodoroMode: true,
        actions: actions({
            run: { visible: false, enabled: false, label: 'start' },
            startSession: { visible: true, enabled: true, label: 'startSession' },
        }),
    });
    assert.equal(menu.toggle.visible, false);
    assert.deepEqual(menu.startSession, { visible: true, sensitive: true });
    assert.deepEqual(menu.mode, { text: 'Pomodoro mode', checked: true, sensitive: true });
});

test('an active session shows its own items', () => {
    const menu = menuFor({
        actions: actions({
            run: { visible: false, enabled: false, label: 'start' },
            nextPhase: { visible: true, enabled: true, label: 'shortRest' },
            endSession: { visible: true, enabled: true, label: 'endSession' },
            mode: { visible: true, enabled: false, label: 'pomodoroModeLocked' },
        }),
    });
    assert.equal(menu.toggle.visible, false);
    assert.equal(menu.startSession.visible, false);
    assert.deepEqual(menu.nextPhase, { text: 'Next phase: Short rest', visible: true, sensitive: true });
    assert.deepEqual(menu.endSession, { visible: true, sensitive: true });
    assert.equal(menu.mode.text, 'Pomodoro mode (locked while running)');
    assert.equal(menu.mode.sensitive, false);
});

test('nothing can be chosen without a service', () => {
    const menu = menuFor({ status: null });
    assert.deepEqual(menu.toggle, { text: 'Start', sensitive: false, visible: true });
    assert.equal(menu.project.sensitive, false);
    assert.equal(menu.billable.sensitive, false);
    assert.equal(menu.mode.sensitive, false);
    assert.equal(menu.startSession.visible, false);
    assert.equal(menu.nextPhase.visible, false);
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

test('a cut-short project list says so before the projects, as KDE and macOS do', () => {
    const choices = projectChoices([{ id: 7, name: 'Alpha' }], 7, projectLabel, identity, true);
    assert.deepEqual(choices, [
        { id: 0, label: 'No project', checked: false },
        {
            id: null,
            label: 'Project list cut short. Open Tokkl in a browser for the others.',
            checked: false,
            note: true,
        },
        { id: 7, label: 'Alpha', checked: true },
    ]);
    assert.equal(
        projectChoices([{ id: 7, name: 'Alpha' }], 0, projectLabel, identity, false).some(choice => choice.note),
        false,
    );
});

test('a failed call shows its message, ahead of the session message', () => {
    assert.deepEqual(menuFor({ actionError: 'The timer service did not answer.' }).message, {
        text: 'The timer service did not answer.',
        visible: true,
    });
    assert.equal(
        menuFor({ actionError: 'The timer service did not answer.', sessionMessage: 'Too short to save' }).message.text,
        'The timer service did not answer.',
    );
    assert.deepEqual(menuFor({ actionError: '' }).message, { text: '', visible: false });
});

test('a sound that did not play shows after the other messages', () => {
    const alarmError = 'No alarm sound: Connection refused';
    assert.deepEqual(menuFor({ alarmError }).message, { text: alarmError, visible: true });
    assert.equal(menuFor({ alarmError, sessionMessage: 'Too short to save' }).message.text, 'Too short to save');
    assert.equal(
        menuFor({ alarmError, actionError: 'The timer service did not answer.' }).message.text,
        'The timer service did not answer.',
    );
    // A service from before AlarmError leaves it out.
    assert.deepEqual(menuFor({ alarmError: undefined }).message, { text: '', visible: false });
});

test("a refused request's words show once, also when ErrorString holds them", () => {
    const refused = 'Project is archived';
    const state = serviceState({ status: 'error', actionError: refused });
    const same = describeMenu(state, describeStatus('error', refused, identity), identity);
    assert.deepEqual(same.message, { text: refused, visible: true });
    assert.equal(same.detail.visible, false);
    const other = describeMenu(state, describeStatus('error', 'The instance is unreachable', identity), identity);
    assert.deepEqual(other.detail, { text: 'The instance is unreachable', visible: true });
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
const stopped = {
    status: 'ready',
    running: false,
    paused: false,
    startTime: 0,
    chainSeconds: 0,
    pomodoroMode: false,
    session: null,
};

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
    const shown = describeTime({ ...stopped, status: 'stale', pomodoroMode: true }, offline, '', 0, identity);
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
