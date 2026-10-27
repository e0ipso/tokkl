// Opens the installed extension's preferences in the Extensions app's own
// preferences window, with the extension as GNOME Shell describes it, fills
// in the form, presses Connect and checks what mock-timer.js
// received and what the extension's settings kept. Then it edits the
// Pomodoro lengths and sounds against the mock. Needs a Wayland display
// (the headless GNOME Shell of shell-test.sh) and mock-timer.js on the
// session bus.
//
//   gjs -m prefs-check.js UUID

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {exit, programArgs} from 'system';

const [uuid] = programArgs;
const decoder = new TextDecoder();
const read = path => decoder.decode(GLib.file_get_contents(path)[1]);

// The Extensions app's own start-up: it sets up the gnome-shell package,
// whose modules provide ExtensionPreferences.
const launcher = read('/usr/share/gnome-shell/org.gnome.Shell.Extensions');
const option = name => new RegExp(`${name}: '([^']+)'`).exec(launcher)[1];
imports.package.init({name: 'gnome-shell', prefix: option('prefix'), libdir: option('libdir')});
for (const resource of ['org.gnome.Shell.Extensions.src', 'gnome-shell-dbus-interfaces'])
    Gio.Resource.load(`${option('prefix')}/share/gnome-shell/${resource}.gresource`)._register();

Adw.init();

const app = 'resource:///org/gnome/Shell/Extensions/js';
const {extensionManager} = await import(`${app}/extensionsService.js`);
const {ExtensionPrefsDialog} = await import(`${app}/extensionPrefsDialog.js`);

const bus = Gio.DBus.session;
const [serialized] = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell.Extensions',
    'GetExtensionInfo', new GLib.Variant('(s)', [uuid]), new GLib.VariantType('(a{sv})'),
    Gio.DBusCallFlags.NONE, 10_000, null).deepUnpack();
const extension = extensionManager.createExtensionObject(serialized);

const schemas = Gio.SettingsSchemaSource.new_from_directory(extension.dir.get_child('schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({
    settings_schema: schemas.lookup(extension.metadata['settings-schema'], true),
});

const mockCalls = () => JSON.parse(bus.call_sync('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock',
    'Calls', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, 10_000, null).recursiveUnpack()[0]);
const mockSet = (name, value) => bus.call_sync('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock',
    'Set', new GLib.Variant('(sv)', [name, value]), null, Gio.DBusCallFlags.NONE, 10_000, null);

function delay(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitFor(what, check, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = check();
        if (last === true)
            return;
        await delay(100);
    }
    throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
}

function* descendants(widget) {
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        yield child;
        yield* descendants(child);
    }
}

async function openWindow() {
    const window = new ExtensionPrefsDialog(extension);
    await new Promise(resolve => window.connect('loaded', resolve));
    const widgets = [...descendants(window)];
    const row = (type, title) => {
        const found = widgets.find(widget => widget instanceof type && widget.title === title);
        if (!found)
            throw new Error(`no ${type.name} titled ${title}`);
        return found;
    };
    return {
        window,
        url: row(Adw.EntryRow, 'Instance URL'),
        mode: row(Adw.ComboRow, 'Sign in with'),
        email: row(Adw.EntryRow, 'Email'),
        secret: widgets.find(widget => widget instanceof Adw.PasswordEntryRow),
        status: row(Adw.ActionRow, 'Timer service'),
        monochrome: row(Adw.SwitchRow, 'Use a monochrome panel icon'),
        connect: widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Connect'),
    };
}

let failures = 0;
async function step(name, body) {
    try {
        await body();
        print(`ok - ${name}`);
    } catch (error) {
        failures++;
        print(`not ok - ${name}\n  ${String(error.message).replaceAll('\n', '\n  ')}`);
    }
}

const lastCall = () => mockCalls().at(-1) ?? [];
// Connect is insensitive from the click until the answer is handled.
const answered = () => waitFor('the answer', () => form.connect.sensitive === true);
const sameCall = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected) || actual;

let form;
await step('the preferences open and show the service state', async () => {
    form = await openWindow();
    await waitFor('the status row', () => form.status.subtitle === 'Connected' || form.status.subtitle);
});

await step('the monochrome preference persists without configuring the account', async () => {
    const before = mockCalls().length;
    if (form.monochrome.active)
        throw new Error('monochrome should be off by default');
    form.monochrome.active = true;
    await waitFor('the saved monochrome preference', () => settings.get_boolean('monochrome-icon'));
    form.window.close();
    form = await openWindow();
    if (!form.monochrome.active || mockCalls().slice(before).some(([name]) => name === 'Configure'))
        throw new Error('reopening lost the icon preference or configured the account');
    await waitFor('the reopened connection', () => form.status.subtitle === 'Connected' || form.status.subtitle);
    form.monochrome.active = false;
    await waitFor('color mode', () => !settings.get_boolean('monochrome-icon'));
});

await step('Connect sends the URL, email and password to Configure', async () => {
    form.url.text = 'https://tokkl.example.com';
    form.mode.selected = 1;
    if (!form.email.visible || form.secret.title !== 'Password')
        throw new Error('password sign-in does not show the email and password rows');
    form.email.text = 'me@example.com';
    form.secret.text = 'hunter2';
    form.connect.emit('clicked');
    await waitFor('Configure', () => sameCall(lastCall(),
        ['Configure', 'https://tokkl.example.com', 'password', 'me@example.com', 'hunter2']));
    await answered();
    if (form.secret.text !== '')
        throw new Error('the secret stayed in the form');
    const saved = ['instance-url', 'auth-mode', 'email'].map(key => settings.get_string(key));
    if (sameCall(saved, ['https://tokkl.example.com', 'password', 'me@example.com']) !== true)
        throw new Error(`saved settings: ${JSON.stringify(saved)}`);
});

await step('token sign-in sends no email, and an empty token keeps the saved one', async () => {
    form.mode.selected = 0;
    if (form.email.visible || form.secret.title !== 'API token')
        throw new Error('token sign-in still shows the email row');
    form.connect.emit('clicked');
    await waitFor('Configure', () => sameCall(lastCall(),
        ['Configure', 'https://tokkl.example.com', 'token', '', '']));
    await answered();
});

await step('a refused configuration keeps the form and the saved settings', async () => {
    const before = mockCalls().length;
    form.url.text = 'http://insecure.example.com';
    form.secret.text = 'token-value';
    form.connect.emit('clicked');
    await waitFor('Configure', () => mockCalls().length > before);
    await answered();
    if (form.secret.text !== 'token-value')
        throw new Error('the secret was cleared after an error');
    if (settings.get_string('instance-url') !== 'https://tokkl.example.com')
        throw new Error(`instance-url changed to ${settings.get_string('instance-url')}`);
});

await step('the form opens with the last accepted values', async () => {
    form.window.close();
    const again = await openWindow();
    if (again.url.text !== 'https://tokkl.example.com' || again.mode.selected !== 0 || again.secret.text !== '')
        throw new Error(`url ${again.url.text}, mode ${again.mode.selected}, secret ${again.secret.text}`);
    again.window.close();
});

// The Pomodoro rows by the keys of PomodoroLengths and Sounds.
const lengthTitles = {work: 'Work', shortRest: 'Short rest', longRest: 'Long rest', longRestEvery: 'Long rest every'};
const soundTitles = {
    workToShortRest: 'Work → short rest',
    shortRestToWork: 'Short rest → work',
    workToLongRest: 'Work → long rest',
    longRestToWork: 'Long rest → work',
};

function pomodoroGroup(window) {
    const group = [...descendants(window)]
        .find(widget => widget instanceof Adw.PreferencesGroup && widget.title === 'Pomodoro');
    if (!group)
        throw new Error('no Pomodoro group');
    const widgets = [...descendants(group)];
    const rows = (type, titles) => Object.fromEntries(Object.entries(titles).map(([key, title]) => {
        const found = widgets.find(widget => widget instanceof type && widget.title === title);
        if (!found)
            throw new Error(`no ${type.name} titled ${title} in the Pomodoro group`);
        return [key, found];
    }));
    const button = (parent, label) => {
        const found = [...descendants(parent)].find(widget => widget instanceof Gtk.Button && widget.label === label);
        if (!found)
            throw new Error(`no ${label} button in ${parent.title}`);
        return found;
    };
    const sounds = rows(Adw.ComboRow, soundTitles);
    return {
        window,
        group,
        lengths: rows(Adw.SpinRow, lengthTitles),
        save: button(group, 'Save lengths'),
        sounds,
        previews: Object.fromEntries(Object.entries(sounds).map(([key, row]) => [key, button(row, 'Preview')])),
    };
}

const lengthValues = form => Object.fromEntries(Object.entries(form.lengths).map(([key, row]) => [key, row.value]));
const choiceLabels = row => Array.from({length: row.model.get_n_items()}, (_, index) => row.model.get_item(index).string);
const lengthsVariant = lengths => new GLib.Variant('a{si}', lengths);

let pomodoro;
await step('the Pomodoro group shows the lengths read on opening and the chosen sounds', async () => {
    mockSet('PomodoroLengths', lengthsVariant({work: 25, shortRest: 5, longRest: 15, longRestEvery: 4}));
    const before = mockCalls().length;
    pomodoro = pomodoroGroup((await openWindow()).window);
    // mock-timer.js answers RefreshPreferences with these.
    await waitFor('the account lengths', () => sameCall(lengthValues(pomodoro),
        {work: 50, shortRest: 10, longRest: 20, longRestEvery: 3}));
    const labels = ['Two falling notes', 'Three rising notes', 'Four slow falling notes', 'Fast high run'];
    await waitFor('the sound choices', () => Object.values(pomodoro.sounds).every((row, index) =>
        row.selected === index && sameCall(choiceLabels(row), labels) === true) ||
        Object.values(pomodoro.sounds).map(row => [row.selected, choiceLabels(row)]));
    const names = mockCalls().slice(before).map(([name]) => name);
    if (!names.includes('RefreshPreferences') || names.includes('SetSound') || names.includes('SetPomodoroLengths'))
        throw new Error(`calls on opening: ${JSON.stringify(names)}`);
});

await step('Save lengths sends the edited lengths, also one still being typed', async () => {
    pomodoro.lengths.work.value = 45;
    pomodoro.lengths.longRestEvery.text = '6';
    pomodoro.save.emit('clicked');
    await waitFor('SetPomodoroLengths', () => sameCall(lastCall(), ['SetPomodoroLengths', 45, 10, 20, 6]));
    await waitFor('the saved lengths', () => sameCall(lengthValues(pomodoro),
        {work: 45, shortRest: 10, longRest: 20, longRestEvery: 6}));
});

await step('lengths changed elsewhere replace the rows', async () => {
    // Also waits out the service's answer to the last save, which comes
    // before this change.
    mockSet('PomodoroLengths', lengthsVariant({work: 40, shortRest: 10, longRest: 20, longRestEvery: 6}));
    await waitFor('the new lengths', () => sameCall(lengthValues(pomodoro),
        {work: 40, shortRest: 10, longRest: 20, longRestEvery: 6}));
});

await step('a refused length shows on its row, the typed lengths stay, and the next save clears it', async () => {
    const work = pomodoro.lengths.work;
    const refusal = 'Work must be at most 90 minutes.';
    work.value = 120;
    const typed = lengthValues(pomodoro);
    mockSet('PomodoroLengthErrors', new GLib.Variant('a{ss}', {work: refusal, general: 'The server did not answer.'}));
    await waitFor('the error on Work', () => (work.subtitle === refusal && work.has_css_class('error')) || work.subtitle);
    const marked = Object.entries(pomodoro.lengths).filter(([, row]) => row.has_css_class('error')).map(([key]) => key);
    if (sameCall(marked, ['work']) !== true)
        throw new Error(`rows marked as refused: ${JSON.stringify(marked)}`);
    if (sameCall(lengthValues(pomodoro), typed) !== true)
        throw new Error(`the typed lengths changed to ${JSON.stringify(lengthValues(pomodoro))}`);
    if (!pomodoro.group.description.includes('The server did not answer.'))
        throw new Error(`the general error is missing from: ${pomodoro.group.description}`);
    pomodoro.save.emit('clicked');
    await waitFor('SetPomodoroLengths', () => sameCall(lastCall(), ['SetPomodoroLengths', 120, 10, 20, 6]));
    await waitFor('no error', () => (!work.has_css_class('error') && work.subtitle !== refusal &&
        !pomodoro.group.description.includes('The server did not answer.')) || work.subtitle);
});

await step('without a connection the lengths are read-only and show the last known values', async () => {
    const known = lengthValues(pomodoro);
    pomodoro.lengths.work.value = 33;
    mockSet('PomodoroLengthsEditable', new GLib.Variant('b', false));
    await waitFor('read-only lengths', () => (Object.values(pomodoro.lengths).every(row => !row.sensitive) &&
        !pomodoro.save.sensitive && pomodoro.group.description.includes('connection to the Tokkl server')) ||
        pomodoro.group.description);
    if (sameCall(lengthValues(pomodoro), known) !== true)
        throw new Error(`read-only rows show ${JSON.stringify(lengthValues(pomodoro))}`);
    if (Object.values(pomodoro.sounds).some(row => !row.sensitive))
        throw new Error('the sounds turned read-only too');
    mockSet('PomodoroLengthsEditable', new GLib.Variant('b', true));
    await waitFor('editable lengths', () => Object.values(pomodoro.lengths).every(row => row.sensitive) &&
        pomodoro.save.sensitive);
});

await step('choosing a sound sends it to SetSound once', async () => {
    const before = mockCalls().length;
    pomodoro.sounds.workToShortRest.selected = 2;
    await waitFor('SetSound', () => sameCall(lastCall(), ['SetSound', 'workToShortRest', 'work-to-long-rest']));
    // The service's update of Sounds comes back and must not be sent again.
    await delay(500);
    const sent = mockCalls().slice(before).filter(([name]) => name === 'SetSound');
    if (sent.length !== 1 || pomodoro.sounds.workToShortRest.selected !== 2)
        throw new Error(`SetSound calls ${JSON.stringify(sent)}, selected ${pomodoro.sounds.workToShortRest.selected}`);
});

await step('Preview plays the chosen sound', async () => {
    pomodoro.previews.workToShortRest.emit('clicked');
    await waitFor('PreviewSound', () => sameCall(lastCall(), ['PreviewSound', 'work-to-long-rest']));
    pomodoro.window.close();
});

print(failures ? `${failures} failed` : 'all passed');
exit(failures ? 1 : 0);
