// How the org.tokkl.Timer1 proxy that the panel button and the preferences
// window share is made; timer1.js reads its cached properties. Nothing here
// imports from GNOME Shell or GTK, so both processes load it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { BUS_NAME, OBJECT_PATH, TIMER1_XML_FILE } from './timer1.js';

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
