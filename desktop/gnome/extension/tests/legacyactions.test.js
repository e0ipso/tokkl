// Tests for legacyactions.js, the menu rules for a tokkl-timerd without the
// Actions property:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { legacyActions } from '../legacyactions.js';
import { describeMenu } from '../menumodel.js';
import { chosenProjectLabel, describeStatus, fill, nextPhaseLabel, pomodoroModeLabel } from '../timer1.js';

const identity = text => text;

// describeMenu() as the extension had it before the Actions property: the
// menu an older service's extension showed.
function menuBeforeActions(state, words, _) {
    const ready = state.status === 'ready';
    const timerHeld = state.running || state.paused;
    const chosen = chosenProjectLabel(state.projects, state.chosenProject, state.chosenProjectName, _);
    let projectText = fill(_('Project: %s'), chosen);
    if (state.running) projectText = fill(_('Project: %s (locked while running)'), chosen);
    else if (state.paused) projectText = fill(_('Project: %s (locked while paused)'), chosen);
    const message = state.actionError || state.sessionMessage;
    return {
        message: { text: message, visible: message.length > 0 },
        detail: { text: words.detail, visible: words.detail.length > 0 },
        toggle: {
            text: timerHeld ? _('Stop') : _('Start'),
            sensitive: ready,
            visible: !state.sessionActive && (!state.pomodoroMode || timerHeld),
        },
        startSession: {
            visible: state.pomodoroMode && !state.sessionActive && !timerHeld,
            sensitive: state.canStartSession,
        },
        nextPhase: { text: nextPhaseLabel(state.upcomingPhase, _), visible: state.sessionActive },
        endSession: { visible: state.sessionActive },
        mode: {
            text: pomodoroModeLabel(state.modeLocked, _),
            checked: state.pomodoroMode,
            sensitive: state.status !== null && !state.modeLocked,
        },
        project: { text: projectText, sensitive: ready && !state.running && !state.paused },
        billable: { checked: state.billable, sensitive: ready && !state.paused },
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
        ...overrides,
    };
}

// Every combination of what the old rules read.
function* states() {
    for (const status of ['ready', 'busy', 'error', 'stale', 'loading', 'unconfigured', null])
        for (const held of ['none', 'running', 'paused'])
            for (const pomodoroMode of [false, true])
                for (const sessionActive of [false, true])
                    for (const modeLocked of [false, true])
                        for (const canStartSession of [false, true])
                            yield serviceState({
                                status,
                                running: held === 'running',
                                paused: held === 'paused',
                                chosenProject: held === 'none' ? 0 : 7,
                                pomodoroMode,
                                sessionActive,
                                modeLocked,
                                canStartSession,
                                upcomingPhase: sessionActive ? 'longRest' : '',
                            });
}

test('without Actions the menu is the one the extension showed before Actions', () => {
    let checked = 0;
    for (const base of states()) {
        for (const missing of [null, undefined]) {
            const state = { ...base, actions: missing };
            const words = describeStatus(state.status, '', identity);
            const expected = menuBeforeActions(state, words, identity);
            // The old menu never set Next phase and End session insensitive,
            // so they stayed sensitive; the legacy rules say so outright.
            expected.nextPhase.sensitive = true;
            expected.endSession.sensitive = true;
            assert.deepEqual(describeMenu(state, words, identity), expected, JSON.stringify(state));
            checked++;
        }
    }
    assert.equal(checked, 7 * 3 * 2 * 2 * 2 * 2 * 2);
});

test('with Actions the menu follows Actions, not the legacy rules', () => {
    // Ready and stopped, where the legacy rules would offer Start; the
    // service says otherwise.
    const actions = {
        ...legacyActions(serviceState()),
        run: { visible: true, enabled: false, label: 'stop' },
        project: { visible: true, enabled: false, label: 'projectPaused' },
        mode: { visible: true, enabled: false, label: 'pomodoroModeLocked' },
    };
    const state = serviceState({ actions });
    const menu = describeMenu(state, describeStatus('ready', '', identity), identity);
    assert.deepEqual(menu.toggle, { text: 'Stop', sensitive: false, visible: true });
    assert.deepEqual(menu.project, { text: 'Project: No project (locked while paused)', sensitive: false });
    assert.equal(menu.mode.text, 'Pomodoro mode (locked while running)');
    assert.equal(menu.mode.sensitive, false);
});

test('the legacy rules have every action the Actions property has', () => {
    assert.deepEqual(Object.keys(legacyActions(serviceState())).sort(), [
        'billable',
        'endSession',
        'mode',
        'nextPhase',
        'project',
        'run',
        'startSession',
    ]);
});
