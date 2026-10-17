// Connection settings for the Tokkl extension. Connect sends them to
// tokkl-timerd's Configure method; the service checks them, stores the token
// or password in the keyring and connects. The extension's own settings keep
// the instance URL, sign-in method and email that were last accepted, so the
// form opens filled in. No secret is ever stored here.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AUTH_MODES, BUS_NAME, OBJECT_PATH, TIMER1_INTERFACE, describeStatus} from './timer1.js';

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(TIMER1_INTERFACE);

export default class TokklPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('Connection'),
            icon_name: 'network-server-symbolic',
        });
        window.add(page);

        const status = new Adw.ActionRow({title: _('Timer service')});
        const statusGroup = new Adw.PreferencesGroup();
        statusGroup.add(status);
        page.add(statusGroup);

        const group = new Adw.PreferencesGroup({
            title: _('Tokkl instance'),
            description: _('tokkl-timerd keeps the token or password in the keyring. Leave it empty to keep the saved one.'),
        });
        page.add(group);

        const url = new Adw.EntryRow({
            title: _('Instance URL'),
            text: settings.get_string('instance-url'),
            input_purpose: Gtk.InputPurpose.URL,
        });
        group.add(url);

        const modes = new Adw.ComboRow({
            title: _('Sign in with'),
            model: Gtk.StringList.new([_('API token'), _('Email and password')]),
        });
        modes.selected = Math.max(0, AUTH_MODES.indexOf(settings.get_string('auth-mode')));
        group.add(modes);

        const email = new Adw.EntryRow({
            title: _('Email'),
            text: settings.get_string('email'),
            input_purpose: Gtk.InputPurpose.EMAIL,
        });
        group.add(email);

        const secret = new Adw.PasswordEntryRow();
        group.add(secret);

        const syncMode = () => {
            const password = AUTH_MODES[modes.selected] === 'password';
            email.visible = password;
            secret.title = password ? _('Password') : _('API token');
        };
        modes.connect('notify::selected', syncMode);
        syncMode();

        const connect = new Gtk.Button({
            label: _('Connect'),
            halign: Gtk.Align.END,
            css_classes: ['suggested-action'],
        });
        const buttonGroup = new Adw.PreferencesGroup();
        buttonGroup.add(connect);
        page.add(buttonGroup);

        const cancellable = new Gio.Cancellable();
        let proxy = null;
        const showStatus = () => {
            const owned = Boolean(proxy?.g_name_owner);
            const words = describeStatus(owned ? proxy.Status : null, owned ? proxy.ErrorString : '', _);
            status.subtitle = words.detail ? `${words.text}: ${words.detail}` : words.text;
        };
        status.subtitle = _('Connecting to the timer service…');

        new Timer1Proxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH, (created, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    status.subtitle = error.message;
                return;
            }
            proxy = created;
            const signals = [
                proxy.connect('g-properties-changed', showStatus),
                proxy.connect('notify::g-name-owner', showStatus),
            ];
            window.connect('close-request', () => {
                signals.forEach(id => proxy.disconnect(id));
                return false;
            });
            showStatus();
        }, cancellable);
        window.connect('close-request', () => {
            cancellable.cancel();
            return false;
        });

        connect.connect('clicked', () => {
            if (!proxy)
                return;
            const mode = AUTH_MODES[modes.selected];
            const values = {url: url.text.trim(), mode, email: email.text.trim()};
            connect.sensitive = false;
            // The email belongs to password sign-in only.
            const address = mode === 'password' ? values.email : '';
            proxy.ConfigureRemote(values.url, mode, address, secret.text, (result, error) => {
                connect.sensitive = true;
                if (error) {
                    Gio.DBusError.strip_remote_error(error);
                    window.add_toast(new Adw.Toast({title: error.message, timeout: 0}));
                    return;
                }
                settings.set_string('instance-url', values.url);
                settings.set_string('auth-mode', values.mode);
                settings.set_string('email', values.email);
                secret.text = '';
                window.add_toast(new Adw.Toast({title: _('Sent to the timer service')}));
            });
        });
    }
}
