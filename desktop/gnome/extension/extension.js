// Tokkl for the GNOME top bar: a panel button for the timer of tokkl-timerd.
// The service on the session bus (org.tokkl.Timer1) holds the timer, the
// connection and the credentials. This extension shows its state and calls
// its methods; it keeps no timer state of its own.

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TokklIndicator} from './indicator.js';
import {BUS_NAME, OBJECT_PATH, TIMER1_INTERFACE} from './timer1.js';

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(TIMER1_INTERFACE);

export default class TokklExtension extends Extension {
    enable() {
        this._indicator = new TokklIndicator(this.dir.get_child('tokkl.png'), () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Creating the proxy starts tokkl-timerd through D-Bus activation
        // when it is not running yet.
        this._cancellable = new Gio.Cancellable();
        const indicator = this._indicator;
        new Timer1Proxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH, (proxy, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`Tokkl: cannot reach ${BUS_NAME}: ${error.message}`);
                return;
            }
            indicator.setProxy(proxy);
        }, this._cancellable);
    }

    disable() {
        this._cancellable.cancel();
        this._cancellable = null;
        this._indicator.destroy();
        this._indicator = null;
    }
}
