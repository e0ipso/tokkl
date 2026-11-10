// No GNOME Shell or GTK imports, so both the Shell and the preferences load it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { BUS_NAME, OBJECT_PATH, TIMER1_XML_FILE } from './timer1.js';

// The file tokkl-timerd installs, so the proxy matches what the service publishes.
function readInterface() {
    const uri = GLib.Uri.resolve_relative(import.meta.url, TIMER1_XML_FILE, GLib.UriFlags.NONE);
    const [, bytes] = Gio.File.new_for_uri(uri).load_contents(null);
    const xml = new TextDecoder().decode(bytes);
    if (!Gio.DBusNodeInfo.new_for_xml(xml).lookup_interface(BUS_NAME))
        throw new Error(`${TIMER1_XML_FILE} does not describe ${BUS_NAME}`);
    return xml;
}

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(readInterface());

// Starts tokkl-timerd through D-Bus activation if it is not running. A
// cancelled call reports nothing.
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
