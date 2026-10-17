// Drives the installed extension inside a running GNOME Shell against
// mock-timer.js and reports every step that fails. shell-driver.js has the
// helpers that read and operate the panel button.
//
//   gjs -m shell-check.js UUID MOCK_TIMER_JS TIMER1_XML

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {exit, programArgs} from 'system';
import {call, delay, panelButton, shell, steps, waitFor, waitForEnabled} from './shell-driver.js';

const [uuid, mockTimer, timer1Xml] = programArgs;

const mockCalls = () => JSON.parse(call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Calls',
    null, '(s)')[0]);
const mockSet = (name, value) => call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Set',
    new GLib.Variant('(sv)', [name, value]), null);

const checks = steps();
const {step} = checks;
const {button, label, menuOpen, sensitive, pointAtButton, click, press} = panelButton(uuid);
const lastCall = () => mockCalls().at(-1) ?? [];

await step('the extension is enabled without errors', () => waitForEnabled(uuid));

await step('without the service the button says it is not running', async () => {
    await waitFor('the mark', () => label() === '0:00:00!' || label());
    const status = shell(`${button}._statusItem.label.text`);
    if (status !== 'Timer service not running')
        throw new Error(`status: ${status}`);
});

await step('the button follows a service that starts later', async () => {
    Gio.Subprocess.new(['gjs', '-m', mockTimer, timer1Xml], Gio.SubprocessFlags.NONE);
    await waitFor('the ready time', () => label() === '0:00:00' || label());
});

await step('a primary click starts the timer through the service', async () => {
    await pointAtButton();
    const before = mockCalls().length;
    click(1);
    await waitFor('Start', () => mockCalls().length > before && lastCall()[0] === 'Start' || mockCalls());
    if (menuOpen())
        throw new Error('the click opened the menu');
});

await step('the panel shows the elapsed time from StartTime', async () => {
    const start = Math.floor(Date.now() / 1000) - 3725;
    mockSet('StartTime', new GLib.Variant('x', start));
    await waitFor('1:02:0x', () => /^1:02:0[5-9]$/.test(label()) || label());
    const first = label();
    await waitFor('a tick', () => label() !== first || label(), 3000);
});

await step('the project is locked while running, billable is not', async () => {
    await waitFor('locked project', () => sensitive('_projectMenu') === false);
    if (!sensitive('_billableItem'))
        throw new Error('billable is insensitive while running');
    const before = mockCalls().length;
    shell(`${button}._billableItem.toggle()`);
    await waitFor('SetBillable', () => mockCalls().length > before && lastCall()[0] === 'SetBillable' &&
        lastCall()[1] === true || mockCalls());
    await waitFor('the switch', () => shell(`${button}._billableItem.state`) === true);
});

await step('a second primary click stops the timer', async () => {
    click(1);
    await waitFor('Stop', () => lastCall()[0] === 'Stop' || mockCalls());
    await waitFor('0:00:00', () => label() === '0:00:00' || label());
});

await step('a stopped timer lets the menu choose the project', async () => {
    await waitFor('unlocked project', () => sensitive('_projectMenu') === true);
    shell(`${button}._projectMenu.menu._getMenuItems()[1].activate(null)`);
    await waitFor('SetProject 7', () => lastCall()[0] === 'SetProject' && lastCall()[1] === 7 || mockCalls());
    await waitFor('the title', () => shell(`${button}._projectMenu.label.text`) === 'Project: Website (Acme)' ||
        shell(`${button}._projectMenu.label.text`));
});

await step('a change from the service sends nothing back', async () => {
    const before = mockCalls().length;
    const billable = shell(`${button}._billableItem.state`);
    mockSet('Billable', new GLib.Variant('b', !billable));
    await waitFor('the switch', () => shell(`${button}._billableItem.state`) === !billable);
    await delay(300);
    if (mockCalls().length !== before)
        throw new Error(`unexpected calls: ${JSON.stringify(mockCalls().slice(before))}`);
});

await step('a secondary click opens the menu and sends nothing', async () => {
    const before = mockCalls().length;
    click(3);
    await waitFor('the menu', () => menuOpen() === true);
    await delay(300);
    if (mockCalls().length !== before)
        throw new Error(`unexpected calls: ${JSON.stringify(mockCalls().slice(before))}`);
    shell(`${button}.menu.close()`);
});

await step('Space opens the menu, and its Start item starts the timer', async () => {
    const before = mockCalls().length;
    await waitFor('the menu from Space', () => {
        if (!menuOpen())
            press('KEY_space');
        return menuOpen() === true;
    });
    if (shell(`${button}._toggleItem.label.text`) !== 'Start')
        throw new Error('the menu does not offer Start');
    shell(`${button}._toggleItem.activate(null)`);
    await waitFor('Start', () => lastCall()[0] === 'Start' || mockCalls().slice(before));
    shell(`${button}.menu.close()`);
    click(1);
    await waitFor('Stop', () => lastCall()[0] === 'Stop' || mockCalls().slice(before));
});

await step('a status other than ready marks the time and disables writes', async () => {
    mockSet('ErrorString', new GLib.Variant('s', 'Network down'));
    mockSet('Status', new GLib.Variant('s', 'stale'));
    await waitFor('the mark', () => label() === '0:00:00!' || label());
    if (sensitive('_toggleItem') || sensitive('_projectMenu') || sensitive('_billableItem'))
        throw new Error('a write control stayed sensitive');
    const detail = shell(`${button}._detailItem.label.text`);
    if (detail !== 'Network down')
        throw new Error(`detail: ${detail}`);
    mockSet('Status', new GLib.Variant('s', 'ready'));
    await waitFor('no mark', () => label() === '0:00:00' || label());
});

await step('the button says so when the service goes away', async () => {
    call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Quit', null, null);
    await waitFor('the mark', () => label() === '0:00:00!' || label());
    const status = shell(`${button}._statusItem.label.text`);
    if (status !== 'Timer service not running')
        throw new Error(`status: ${status}`);
    if (sensitive('_toggleItem'))
        throw new Error('Start stayed sensitive');
});

print(checks.failures ? `${checks.failures} failed` : 'all passed');
exit(checks.failures ? 1 : 0);
