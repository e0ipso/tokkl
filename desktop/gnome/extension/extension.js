// The service on the session bus holds the timer, connection and credentials.
// The extension keeps no timer state of its own.

import Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TokklIndicator } from './indicator.js';
import { BUS_NAME } from './timer1.js';
import { createTimer1Proxy } from './timer1proxy.js';

export default class TokklExtension extends Extension {
    enable() {
        this._indicator = new TokklIndicator(this.dir.get_child('tokkl.png'), () => this.openPreferences());
        const settings = this.getSettings();
        const indicator = this._indicator;
        const updateIcons = () => {
            const monochrome = settings.get_boolean('monochrome-icon');
            indicator.setLogo(this.dir.get_child(monochrome ? 'tokkl-symbolic.symbolic.png' : 'tokkl.png'));
            indicator.setHourglass(this.dir.get_child(monochrome ? 'hourglass-symbolic.svg' : 'hourglass.svg'));
        };
        settings.connectObject('changed::monochrome-icon', updateIcons, indicator);
        updateIcons();
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._cancellable = new Gio.Cancellable();
        createTimer1Proxy(
            this._cancellable,
            proxy => indicator.setProxy(proxy),
            error => console.warn(`Tokkl: cannot reach ${BUS_NAME}: ${error.message}`),
        );
    }

    disable() {
        this._cancellable.cancel();
        this._cancellable = null;
        this._indicator.destroy();
        this._indicator = null;
    }
}
