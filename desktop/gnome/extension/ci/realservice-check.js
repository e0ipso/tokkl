// Drives the installed extension inside a running GNOME Shell against a real
// tokkl-timerd connected to a real Tokkl server, so the service's properties
// reach the panel and the panel's clicks reach the server. It reads the
// server's address, the account's API token and a project from the
// TOKKL_GNOME_FIXTURE environment variable (JSON: url, token, project with
// id, name and color). realservice.test.ts serves that server and checks its
// data after this exits.
//
//   gjs -m realservice-check.js UUID TOKKL_TIMERD

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {exit, programArgs} from 'system';
import {call, panelButton, shell, steps, waitFor, waitForEnabled} from './shell-driver.js';
import {formatElapsed} from '../timer1.js';

const [uuid, timerd] = programArgs;
const fixture = JSON.parse(GLib.getenv('TOKKL_GNOME_FIXTURE') ?? 'null');
if (!fixture?.url || !fixture?.token || !fixture?.project) {
    printerr('error: TOKKL_GNOME_FIXTURE needs url, token and project');
    exit(2);
}

const checks = steps();
const {step} = checks;
const {button, label, sensitive, pointAtButton, click} = panelButton(uuid);
const statusText = () => shell(`${button}._statusItem.label.text`);
const projectTitle = () => shell(`${button}._projectMenu.label.text`);

const timer = (method, params = null, replyType = null) => call('org.tokkl.Timer1', '/org/tokkl/Timer1',
    'org.tokkl.Timer1', method, params, replyType);
const property = name => call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.freedesktop.DBus.Properties', 'Get',
    new GLib.Variant('(ss)', ['org.tokkl.Timer1', name]), '(v)')[0];

let service = null;

await step('the extension is enabled without errors', () => waitForEnabled(uuid));

await step('an unconfigured service marks the button and says so', async () => {
    service = Gio.Subprocess.new([timerd], Gio.SubprocessFlags.NONE);
    await waitFor('Status unconfigured', () => property('Status') === 'unconfigured' || property('Status'));
    await waitFor('the mark', () => label() === '0:00!' || label());
    await waitFor('the status', () => statusText() === 'Not configured' || statusText());
    if (sensitive('_toggleItem'))
        throw new Error('Start is sensitive before the service is configured');
});

await step('Configure connects the service and the button follows to ready', async () => {
    timer('Configure', new GLib.Variant('(ssss)', [fixture.url, 'token', '', fixture.token]));
    await waitFor('Status ready', () => property('Status') === 'ready' || property('Status'), 30_000);
    await waitFor('no mark', () => label() === '0:00' || label());
    await waitFor('the status', () => statusText() === 'Connected' || statusText());
    if (!sensitive('_toggleItem'))
        throw new Error('Start stayed insensitive');
});

await step('the server\'s projects reach the project menu', async () => {
    const ids = property('Projects').map(project => project.id);
    if (!ids.includes(fixture.project.id))
        throw new Error(`Projects: ${JSON.stringify(ids)}`);
    await waitFor('the project item', () => {
        const items = shell(`${button}._projectMenu.menu._getMenuItems().map(item => item.label.text)`);
        return items.includes(fixture.project.name) || items;
    });
});

await step('choosing a project in the menu sets it on the service', async () => {
    shell(`${button}._projectMenu.menu._getMenuItems()
        .find(item => item.label.text === ${JSON.stringify(fixture.project.name)}).activate(null)`);
    await waitFor('ChosenProject', () => property('ChosenProject') === fixture.project.id || property('ChosenProject'));
    await waitFor('the title', () => projectTitle() === `Project: ${fixture.project.name}` || projectTitle());
    await waitFor('the indicator', () => property('IndicatorState') === 'project' &&
        property('IndicatorColor') === fixture.project.color || [property('IndicatorState'), property('IndicatorColor')]);
});

await step('a primary click starts an entry on the server', async () => {
    await pointAtButton();
    const before = Math.floor(Date.now() / 1000);
    click(1);
    await waitFor('Running', () => property('Running') === true, 30_000);
    const start = property('StartTime');
    if (Math.abs(start - before) > 60)
        throw new Error(`StartTime ${start} is not near ${before}`);
    // Whole minutes: the entry has just started.
    await waitFor('the running time', () => label() === '0:00' && property('Status') === 'ready' || label());
    await waitFor('the locked project', () => sensitive('_projectMenu') === false);
});

await step('billable switched on while running edits the running entry', async () => {
    shell(`${button}._billableItem.toggle()`);
    await waitFor('Billable', () => property('Billable') === true, 30_000);
    await waitFor('ready', () => property('Status') === 'ready' || property('Status'), 30_000);
    await waitFor('the switch', () => shell(`${button}._billableItem.state`) === true);
});

let chain = 0;

await step('a second primary click pauses: the server stops the entry and the time holds its seconds', async () => {
    click(1);
    await waitFor('Paused', () => property('Paused') === true && property('Running') === false &&
        property('StartTime') === 0, 30_000);
    await waitFor('ready', () => property('Status') === 'ready' || property('Status'), 30_000);
    // The entry ran seconds, under half a step of the time resolution, so the server sent it to the
    // trash at zero length and the chain adds nothing.
    chain = property('ChainSeconds');
    if (chain !== 0)
        throw new Error(`ChainSeconds ${chain}`);
    await waitFor('the chain total', () => label() === formatElapsed(chain) || label());
    if (!shell(`${button}.accessible_name`).startsWith(`Paused ${formatElapsed(chain)} · `))
        throw new Error(`button name: ${shell(`${button}.accessible_name`)}`);
    if (shell(`${button}._toggleItem.label.text`) !== 'Stop')
        throw new Error('the menu does not offer Stop while paused');
    if (sensitive('_projectMenu') || sensitive('_billableItem'))
        throw new Error('the project or billable stayed sensitive while paused');
});

await step('a primary click resumes: the server starts a clone and the time counts on', async () => {
    click(1);
    await waitFor('Running', () => property('Running') === true && property('Paused') === false, 30_000);
    await waitFor('ready', () => property('Status') === 'ready' || property('Status'), 30_000);
    if (property('ChainSeconds') !== chain)
        throw new Error(`ChainSeconds ${property('ChainSeconds')}, not ${chain}`);
    if (property('ChosenProject') !== fixture.project.id || property('Billable') !== true)
        throw new Error(`the clone has project ${property('ChosenProject')}, billable ${property('Billable')}`);
    const now = Math.floor(Date.now() / 1000);
    const total = [0, 60].map(slack => formatElapsed(chain + Math.max(0, now - property('StartTime')) + slack));
    await waitFor('the chain total', () => total.includes(label()) || [label(), total]);
});

await step('Stop in the menu stops the clone on the server and ends the chain', async () => {
    shell(`${button}._toggleItem.activate(null)`);
    await waitFor('stopped', () => property('Running') === false && property('Paused') === false &&
        property('StartTime') === 0 && property('ChainSeconds') === 0, 30_000);
    await waitFor('ready', () => property('Status') === 'ready' || property('Status'), 30_000);
    await waitFor('0:00', () => label() === '0:00' || label());
    await waitFor('Start', () => shell(`${button}._toggleItem.label.text`) === 'Start');
    await waitFor('the unlocked project', () => sensitive('_projectMenu') === true);
});

await step('the button says so when the service goes away', async () => {
    service.force_exit();
    service.wait(null);
    service = null;
    await waitFor('the mark', () => label() === '0:00!' || label());
    if (statusText() !== 'Timer service not running')
        throw new Error(`status: ${statusText()}`);
});

service?.force_exit();
print(checks.failures ? `${checks.failures} failed` : 'all passed');
exit(checks.failures ? 1 : 0);
