// The org.tokkl.Timer1 proxy that the panel button and the preferences
// window share: how it is made and how its cached properties are read.
// Nothing here imports from GNOME Shell or GTK, so both processes load it.

import Gio from 'gi://Gio';

import { BUS_NAME, OBJECT_PATH, TIMER1_INTERFACE } from './timer1.js';

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(TIMER1_INTERFACE);

/**
 * Makes the proxy on the session bus. Making it starts tokkl-timerd through
 * D-Bus activation when it is not running yet. A cancelled call reports
 * nothing.
 *
 * @param {Gio.Cancellable} cancellable
 * @param {(proxy: Gio.DBusProxy) => void} onReady
 * @param {(error: GLib.Error) => void} onError
 */
export function createTimer1Proxy(cancellable, onReady, onError) {
    new Timer1Proxy(
        Gio.DBus.session,
        BUS_NAME,
        OBJECT_PATH,
        (proxy, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) onError(error);
                return;
            }
            onReady(proxy);
        },
        cancellable,
    );
}

/**
 * Whether the service owns its name, so the proxy holds its properties.
 *
 * @param {Gio.DBusProxy | null} proxy
 * @returns {boolean}
 */
export function serviceRunning(proxy) {
    return Boolean(proxy?.g_name_owner);
}

/**
 * The property's cached value, or the fallback while the service is gone: a
 * proxy without an owner keeps no properties.
 *
 * @param {Gio.DBusProxy | null} proxy
 * @param {string} name
 * @param {any} fallback
 * @returns {any}
 */
export function cachedProperty(proxy, name, fallback) {
    if (!serviceRunning(proxy)) return fallback;
    const value = proxy.get_cached_property(name);
    return value ? value.recursiveUnpack() : fallback;
}
