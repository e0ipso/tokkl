// Tests for timer1.js, the extension's part that needs no GNOME Shell:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
    AUTH_MODES,
    TIMER1_INTERFACE,
    chosenProjectLabel,
    describeStatus,
    elapsedSeconds,
    formatElapsed,
    projectLabel,
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

test('elapsed time is written H:MM:SS', () => {
    assert.equal(formatElapsed(0), '0:00:00');
    assert.equal(formatElapsed(59), '0:00:59');
    assert.equal(formatElapsed(3600 + 2 * 60 + 3), '1:02:03');
    assert.equal(formatElapsed(100 * 3600), '100:00:00');
    assert.equal(formatElapsed(-5), '0:00:00');
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

test('the sign-in methods are the ones Configure accepts', () => {
    assert.deepEqual(AUTH_MODES, ['token', 'password']);
});
