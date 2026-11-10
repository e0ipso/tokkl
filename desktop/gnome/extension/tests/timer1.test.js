import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
    AUTH_MODES,
    OLDEST_SUPPORTED_INTERFACE_VERSION,
    TIMER1_XML_FILE,
    cachedProperty,
    chosenProjectLabel,
    countdown,
    describeStatus,
    elapsedSeconds,
    fill,
    formatElapsed,
    interfaceVersion,
    nextPhaseLabel,
    outdatedServiceText,
    phaseName,
    pomodoroModeLabel,
    projectLabel,
    refreshProjectsOnOpen,
    serviceOutdated,
    serviceRunning,
    sessionLine,
    supportedProperty,
    supportsService,
} from '../timer1.js';

const identity = text => text;

test('the extension reads the service description by its file name', () => {
    // pack-extension.sh copies this file into the extension; tests read it here.
    const service = readFileSync(new URL(`../../dbus/${TIMER1_XML_FILE}`, import.meta.url), 'utf8');
    assert.match(service, /<interface name="org\.tokkl\.Timer1">/);
});

test('elapsed time counts from StartTime and is 0 when stopped', () => {
    assert.equal(elapsedSeconds(0, 1_700_000_000), 0);
    assert.equal(elapsedSeconds(1_700_000_000, 1_700_000_065.9), 65);
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
    assert.deepEqual(describeStatus('ready', '', identity), { text: 'Connected', detail: '', mark: '' });
    assert.equal(describeStatus('loading', '', identity).mark, '…');
    assert.equal(describeStatus('busy', '', identity).mark, '…');
    for (const status of ['unconfigured', 'stale', 'authentication-blocked', 'error', 'unknown-value', null])
        assert.equal(describeStatus(status, 'why', identity).mark, '!', String(status));
    assert.deepEqual(describeStatus('unknown-value', 'why', identity), describeStatus('error', 'why', identity));
    assert.equal(describeStatus('stale', 'Network down', identity).detail, 'Network down');
    assert.equal(describeStatus('error', 'Server said no', identity).detail, 'Server said no');
    assert.match(describeStatus(null, '', identity).text, /not running/);
    assert.match(describeStatus('unconfigured', '', identity).detail, /settings/);
});

test('project labels name the client, an archived project and the missing project', () => {
    const named = (name, client = '', archived = false) => ({ name, client, archived, missing: false, kind: 'named' });
    const empty = (kind, missing = false) => ({ name: '', client: '', archived: false, missing, kind });
    assert.equal(projectLabel({ name: 'Website', clientName: 'Acme' }), 'Website (Acme)');
    assert.equal(projectLabel({ name: 'Internal', clientName: '' }), 'Internal');
    assert.equal(chosenProjectLabel(empty('none'), identity), 'No project');
    assert.equal(chosenProjectLabel(named('Internal'), identity), 'Internal');
    assert.equal(chosenProjectLabel(named('Website', 'Acme'), identity), 'Website (Acme)');
    assert.equal(chosenProjectLabel(named('Legacy', '', true), identity), 'Legacy (archived)');
    assert.equal(chosenProjectLabel(named('Legacy', 'Acme', true), identity), 'Legacy (Acme) (archived)');
    assert.equal(chosenProjectLabel(empty('unavailable', true), identity), 'Unavailable project');
    assert.equal(chosenProjectLabel(empty('unknown'), identity), 'Unknown project');
    assert.equal(chosenProjectLabel({ ...named('Later'), kind: 'grouped' }, identity), 'Unknown project');
    assert.equal(chosenProjectLabel({}, identity), 'No project');
});

test('the countdown rounds the time left up and the overtime down', () => {
    const end = 1_700_001_500;
    assert.deepEqual(countdown(end, end - 1500), { text: '25:00', overtime: false });
    assert.deepEqual(countdown(end, end - 1499.2), { text: '25:00', overtime: false });
    assert.deepEqual(countdown(end, end - 0.001), { text: '0:01', overtime: false });
    assert.deepEqual(countdown(end, end), { text: '+0:00', overtime: true });
    assert.deepEqual(countdown(end, end + 0.999), { text: '+0:00', overtime: true });
    assert.deepEqual(countdown(end, end + 61.5), { text: '+1:01', overtime: true });
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
    const session = { phase: 'shortRest', plannedEnd: 1_700_000_250, pomodoroNumber: 2, longRestEvery: 4 };
    assert.equal(sessionLine(session, 1_700_000_000, identity), 'Short rest · 4:10 left · Pomodoro 2 of 4');
    assert.equal(
        sessionLine({ ...session, phase: 'work', pomodoroNumber: 3 }, 1_700_000_312, identity),
        'Work · +1:02 overtime · Pomodoro 3 of 4',
    );
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

test('fill puts the values into %s and %d in order', () => {
    assert.equal(fill('Project: %s', 'Inbox'), 'Project: Inbox');
    assert.equal(fill('%s · %s · Pomodoro %d of %d', 'Work', '4:10 left', 2, 4), 'Work · 4:10 left · Pomodoro 2 of 4');
    assert.equal(fill('No values'), 'No values');
});

test('fill puts a value at %1$s or %2$d where the translation places it', () => {
    assert.equal(
        fill('%1$s · %2$s · Pomodoro %3$d of %4$d', 'Work', '4:10 left', 2, 4),
        'Work · 4:10 left · Pomodoro 2 of 4',
    );
    assert.equal(fill('%2$s, %1$s', 'Connected', '1:01'), '1:01, Connected');
    assert.equal(fill('Pomodoro %3$d of %4$d · %1$s', 'Work', '4:10 left', 2, 4), 'Pomodoro 2 of 4 · Work');
    assert.equal(fill('%1$s %1$s', 'Twice'), 'Twice Twice');
});

test('a translation that reorders the session line shows the same values', () => {
    const session = { phase: 'shortRest', plannedEnd: 1_700_000_250, pomodoroNumber: 2, longRestEvery: 4 };
    const reordered = text =>
        text === '%1$s · %2$s · Pomodoro %3$d of %4$d' ? 'Pomodoro %3$d/%4$d: %1$s (%2$s)' : text;
    assert.equal(sessionLine(session, 1_700_000_000, reordered), 'Pomodoro 2/4: Short rest (4:10 left)');
});

test('a service below the floor is not used, and the menu asks for an update', () => {
    assert.equal(OLDEST_SUPPORTED_INTERFACE_VERSION, 2);
    assert.equal(supportsService(0), false);
    assert.equal(supportsService(1), false);
    assert.equal(supportsService(2), true);
    assert.equal(supportsService(3), true);
    for (const status of ['ready', 'error', 'loading']) {
        assert.deepEqual(describeStatus(status, 'Network down', identity, 0), {
            text: 'This timer service is too old; update tokkl-timerd.',
            detail: '',
            mark: '!',
        });
    }
    assert.equal(describeStatus('ready', '', identity, 1).text, 'This timer service is too old; update tokkl-timerd.');
    assert.equal(describeStatus('ready', '', identity, 2).text, 'Connected');
    assert.equal(describeStatus(null, '', identity, 0).text, 'Timer service not running');
});

function fakeProxy(owner, properties) {
    return {
        g_name_owner: owner,
        get_cached_property: name => (name in properties ? { recursiveUnpack: () => properties[name] } : null),
    };
}

test('the panel button and the preferences read nothing of a service below the floor', () => {
    const current = fakeProxy(':1.7', { InterfaceVersion: 2, Status: 'ready' });
    assert.equal(serviceOutdated(current), false);
    assert.equal(supportedProperty(current, 'Status', 'error'), 'ready');
    assert.equal(supportedProperty(current, 'Missing', 'fallback'), 'fallback');

    for (const older of [fakeProxy(':1.7', { InterfaceVersion: 1, Status: 'ready' }), fakeProxy(':1.7', {})]) {
        assert.equal(serviceOutdated(older), true);
        assert.equal(supportedProperty(older, 'Status', 'error'), 'error');
        assert.equal(
            describeStatus('ready', '', identity, interfaceVersion(older)).text,
            outdatedServiceText(identity),
        );
    }

    const gone = fakeProxy(null, { InterfaceVersion: 1, Status: 'ready' });
    assert.equal(serviceRunning(gone), false);
    assert.equal(serviceOutdated(gone), false);
    assert.equal(serviceOutdated(null), false);
    assert.equal(cachedProperty(gone, 'Status', 'none'), 'none');
    assert.equal(interfaceVersion(gone), 0);
});

// A call to a stopped service would start it.
test('opening the menu asks the service to check the projects', () => {
    const checks = [];
    const withMethod = proxy => {
        if (proxy) proxy.RefreshProjectsRemote = done => checks.push(done);
        return proxy;
    };
    const current = withMethod(fakeProxy(':1.7', { InterfaceVersion: 2 }));
    assert.equal(refreshProjectsOnOpen(true, current), true);
    assert.equal(checks.length, 1);
    assert.equal(refreshProjectsOnOpen(false, current), false);
    assert.equal(checks.length, 1);

    for (const proxy of [
        withMethod(fakeProxy(null, { InterfaceVersion: 2 })),
        withMethod(fakeProxy(':1.7', { InterfaceVersion: 1 })),
        null,
    ]) {
        assert.equal(refreshProjectsOnOpen(true, proxy), false);
    }
    assert.equal(checks.length, 1);

    const warn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(message);
    try {
        checks[0](null, new Error('No reply'));
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(warnings, ['Tokkl: RefreshProjects failed: No reply']);
});

test('the extension reads the service only through the shared gate', () => {
    for (const name of ['indicator.js', 'prefs.js']) {
        const source = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
        assert.equal(source.includes('cachedProperty('), false, `${name} reads a property past the gate`);
        assert.match(source, /serviceOutdated\(/, `${name} does not check the floor`);
    }
    const prefs = readFileSync(new URL('../prefs.js', import.meta.url), 'utf8');
    assert.match(
        prefs,
        /describeStatus\([^;]*interfaceVersion\(this\._proxy\)/s,
        'prefs.js words the status without InterfaceVersion',
    );
});

test('the preferences keep no length range of their own', () => {
    const prefs = readFileSync(new URL('../prefs.js', import.meta.url), 'utf8');
    assert.doesNotMatch(prefs, /\b999\b/);
    assert.doesNotMatch(prefs, /lower:|upper:/);
});
