// Drives the installed extension inside a running GNOME Shell against
// mock-timer.js, and fails on the first difference. GNOME Shell's Eval method
// reads the panel and sends pointer and key events; the probe extension that
// shell-test.sh installs turns on the unsafe mode Eval needs.
//
//   gjs -m shell-check.js UUID MOCK_TIMER_JS TIMER1_XML

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {exit, programArgs} from 'system';

const [uuid, mockTimer, timer1Xml] = programArgs;
const bus = Gio.DBus.session;

function call(name, path, iface, method, params, replyType) {
    const reply = bus.call_sync(name, path, iface, method, params,
        replyType ? new GLib.VariantType(replyType) : null, Gio.DBusCallFlags.NONE, 10_000, null);
    return reply ? reply.recursiveUnpack() : [];
}

// Runs code in GNOME Shell's shellDBus.js module, where Main is in scope.
function shell(code) {
    const [ok, result] = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
        new GLib.Variant('(s)', [code]), '(bs)');
    if (!ok)
        throw new Error(`Eval failed: ${result}\n${code}`);
    return result === '' ? undefined : JSON.parse(result);
}

const mockCalls = () => JSON.parse(call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Calls',
    null, '(s)')[0]);
const mockSet = (name, value) => call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Set',
    new GLib.Variant('(sv)', [name, value]), null);

function delay(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitFor(what, check, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            last = check();
            if (last === true)
                return;
        } catch (error) {
            last = error.message;
        }
        await delay(100);
    }
    throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
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

const button = `Main.panel.statusArea[${JSON.stringify(uuid)}]`;
const label = () => shell(`${button}._label.text`);
const lastCall = () => mockCalls().at(-1) ?? [];

// A virtual pointer over the panel button. The seat adds the device and
// the first motion asynchronously, so clicks wait until it is there.
const pointerCode = `
    const {Clutter, GLib} = imports.gi;
    const button = ${button};
    const [x, y] = button.get_transformed_position();
    const [width, height] = button.get_transformed_size();
    const backend = global.stage.get_context?.().get_backend() ?? Clutter.get_default_backend();
    globalThis.tokklPointer ??= backend.get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const pointer = globalThis.tokklPointer;
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);`;

async function pointAtButton() {
    await waitFor('the pointer over the button', () => {
        shell(`(() => {${pointerCode}})()`);
        return shell(`${button}.hover`) === true;
    });
}

// Presses and releases a pointer button over the panel button.
const click = number => shell(`(() => {${pointerCode}
    pointer.notify_button(GLib.get_monotonic_time(), ${number}, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), ${number}, Clutter.ButtonState.RELEASED);
})()`);

// Presses and releases a key while the panel button has the keyboard focus,
// as after Ctrl+Alt+Tab: the stage, not a window, takes the keys.
const press = keyval => shell(`(() => {
    const {Clutter, GLib} = imports.gi;
    const backend = global.stage.get_context?.().get_backend() ?? Clutter.get_default_backend();
    globalThis.tokklKeyboard ??= backend.get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const keyboard = globalThis.tokklKeyboard;
    global.display.unset_input_focus(global.get_current_time());
    ${button}.grab_key_focus();
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.${keyval}, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.${keyval}, Clutter.KeyState.RELEASED);
})()`);

const menuOpen = () => shell(`${button}.menu.isOpen`);
const sensitive = item => shell(`${button}.${item}.sensitive`);

await step('the extension is enabled without errors', () => waitFor('the extension state', () => {
    const info = shell(`(() => {
        const extension = Main.extensionManager.lookup(${JSON.stringify(uuid)});
        return extension && {state: extension.state, error: extension.error ?? ''};
    })()`);
    if (info?.error)
        throw new Error(info.error);
    return info?.state === 1 || info;
}));

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

print(failures ? `${failures} failed` : 'all passed');
exit(failures ? 1 : 0);
