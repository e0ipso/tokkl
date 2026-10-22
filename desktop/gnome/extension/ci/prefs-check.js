// Opens the installed extension's preferences in the Extensions app's own
// preferences window, with the extension as GNOME Shell describes it, fills
// in the form, presses Connect and checks what mock-timer.js
// received and what the extension's settings kept. Needs a Wayland display
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
    if (!form.monochrome.active || mockCalls().length !== before)
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

print(failures ? `${failures} failed` : 'all passed');
exit(failures ? 1 : 0);
