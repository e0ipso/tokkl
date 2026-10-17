// Helpers that drive the installed extension inside a running GNOME Shell,
// shared by shell-check.js (against mock-timer.js) and realservice-check.js
// (against a real tokkl-timerd). GNOME Shell's Eval method reads the panel
// and sends pointer and key events; the probe extension that shell-test.sh
// installs turns on the unsafe mode Eval needs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const bus = Gio.DBus.session;

export function call(name, path, iface, method, params, replyType) {
    const reply = bus.call_sync(name, path, iface, method, params,
        replyType ? new GLib.VariantType(replyType) : null, Gio.DBusCallFlags.NONE, 10_000, null);
    return reply ? reply.recursiveUnpack() : [];
}

// Runs code in GNOME Shell's shellDBus.js module, where Main is in scope.
export function shell(code) {
    const [ok, result] = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
        new GLib.Variant('(s)', [code]), '(bs)');
    if (!ok)
        throw new Error(`Eval failed: ${result}\n${code}`);
    return result === '' ? undefined : JSON.parse(result);
}

export function delay(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

export async function waitFor(what, check, timeoutMs = 15_000) {
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

// Waits until GNOME Shell has enabled the extension, and fails on the error
// it reports instead.
export function waitForEnabled(uuid) {
    return waitFor('the extension state', () => {
        const info = shell(`(() => {
            const extension = Main.extensionManager.lookup(${JSON.stringify(uuid)});
            return extension && {state: extension.state, error: extension.error ?? ''};
        })()`);
        if (info?.error)
            throw new Error(info.error);
        return info?.state === 1 || info;
    });
}

// Runs the steps in order, printing TAP-like lines; returns the number that
// failed.
export function steps() {
    let failures = 0;
    return {
        async step(name, body) {
            try {
                await body();
                print(`ok - ${name}`);
            } catch (error) {
                failures++;
                print(`not ok - ${name}\n  ${String(error.message).replaceAll('\n', '\n  ')}`);
            }
        },
        get failures() {
            return failures;
        },
    };
}

// The panel button of the extension with this UUID, and ways to read and
// operate it.
export function panelButton(uuid) {
    const button = `Main.panel.statusArea[${JSON.stringify(uuid)}]`;

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

    return {
        button,
        label: () => shell(`${button}._label.text`),
        menuOpen: () => shell(`${button}.menu.isOpen`),
        sensitive: item => shell(`${button}.${item}.sensitive`),

        // What the project indicator shows, and the state of its actors.
        indicator: () => shell(`(() => {
            const indicator = ${button}._projectIndicator;
            return {
                ...indicator.shape,
                accessibleName: indicator.accessible_name,
                fillShown: indicator._fill.visible,
                edgeShown: indicator._edge.visible,
                fillOpacity: indicator._fill.opacity,
                edgeOpacity: indicator._edge.opacity,
                width: indicator.width,
                height: indicator.height,
            };
        })()`),

        async pointAtButton() {
            await waitFor('the pointer over the button', () => {
                shell(`(() => {${pointerCode}})()`);
                return shell(`${button}.hover`) === true;
            });
        },

        // Presses and releases a pointer button over the panel button.
        click: number => shell(`(() => {${pointerCode}
            pointer.notify_button(GLib.get_monotonic_time(), ${number}, Clutter.ButtonState.PRESSED);
            pointer.notify_button(GLib.get_monotonic_time(), ${number}, Clutter.ButtonState.RELEASED);
        })()`),

        // Presses and releases a key while the panel button has the keyboard
        // focus, as after Ctrl+Alt+Tab: the stage, not a window, takes the
        // keys.
        press: keyval => shell(`(() => {
            const {Clutter, GLib} = imports.gi;
            const backend = global.stage.get_context?.().get_backend() ?? Clutter.get_default_backend();
            globalThis.tokklKeyboard ??= backend.get_default_seat()
                .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const keyboard = globalThis.tokklKeyboard;
            global.display.unset_input_focus(global.get_current_time());
            ${button}.grab_key_focus();
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.${keyval}, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.${keyval}, Clutter.KeyState.RELEASED);
        })()`),
    };
}

// The WCAG 2 contrast ratio of two colours with red, green and blue from 0
// to 255.
export function contrastRatio(a, b) {
    const luminance = ({red, green, blue}) => {
        const linear = channel => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}
