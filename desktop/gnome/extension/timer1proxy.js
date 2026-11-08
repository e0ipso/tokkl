// The org.tokkl.Timer1 proxy that the panel button and the preferences
// window share: how it is made and how its cached properties are read.
// Nothing here imports from GNOME Shell or GTK, so both processes load it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { BUS_NAME, OBJECT_PATH, TIMER1_XML_FILE, publishes } from './timer1.js';

/**
 * The interface description packed next to this module, as text. It is the
 * file tokkl-timerd installs, so the proxy knows exactly what the service
 * publishes.
 *
 * @returns {string}
 */
function readInterface() {
    const uri = GLib.Uri.resolve_relative(import.meta.url, TIMER1_XML_FILE, GLib.UriFlags.NONE);
    const [, bytes] = Gio.File.new_for_uri(uri).load_contents(null);
    const xml = new TextDecoder().decode(bytes);
    if (!Gio.DBusNodeInfo.new_for_xml(xml).lookup_interface(BUS_NAME))
        throw new Error(`${TIMER1_XML_FILE} does not describe ${BUS_NAME}`);
    return xml;
}

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(readInterface());

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

/**
 * A property the extension has a fallback for, or null when the service
 * does not publish it, by its InterfaceVersion or, without one, by whether
 * the property is there (publishes() in timer1.js). The caller uses the
 * fallback for null.
 *
 * @param {Gio.DBusProxy | null} proxy
 * @param {'Actions'|'Presentation'|'PomodoroLengthLimits'} name
 * @returns {any}
 */
export function publishedProperty(proxy, name) {
    const value = cachedProperty(proxy, name, null);
    return publishes(cachedProperty(proxy, 'InterfaceVersion', 0), name, value !== null) ? value : null;
}
