// Connection settings for the Tokkl extension. Connect sends them to
// tokkl-timerd's Configure method; the service checks them, stores the token
// or password in the keyring and connects. The extension's own settings keep
// the instance URL, sign-in method and email that were last accepted, so the
// form opens filled in. No secret is ever stored here.
//
// The Pomodoro group edits the account's Pomodoro lengths and the sound of
// each transition, also through tokkl-timerd: it sends the lengths on to the
// Tokkl server and keeps the sounds in its own settings.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AUTH_MODES, BUS_NAME, OBJECT_PATH, TIMER1_INTERFACE, describeStatus} from './timer1.js';

const Timer1Proxy = Gio.DBusProxy.makeProxyWrapper(TIMER1_INTERFACE);

class PomodoroGroup {
    /**
     * @param {Adw.PreferencesWindow} window shows the toasts
     */
    constructor(window) {
        this._window = window;
        this._proxy = null;
        this._saving = false;
        // Set while rows follow the service, so the change is not sent back.
        this._syncing = false;
        this._soundIds = [];
        this._choicesKey = '';

        this.group = new Adw.PreferencesGroup({title: _('Pomodoro')});
        this._save = new Gtk.Button({label: _('Save lengths'), valign: Gtk.Align.CENTER});
        this._save.connect('clicked', () => this._saveLengths());
        this.group.header_suffix = this._save;

        // Keyed as PomodoroLengths, with the server's ranges and defaults.
        const minutes = _('Minutes');
        this._lengths = [
            ['work', _('Work'), minutes, 180, 25],
            ['shortRest', _('Short rest'), minutes, 60, 5],
            ['longRest', _('Long rest'), minutes, 60, 15],
            ['longRestEvery', _('Long rest every'), _('Pomodoros'), 12, 4],
        ].map(([key, title, unit, upper, value]) => {
            const row = new Adw.SpinRow({
                title,
                subtitle: unit,
                numeric: true,
                adjustment: new Gtk.Adjustment({lower: 1, upper, value, step_increment: 1, page_increment: 5}),
            });
            this.group.add(row);
            return {key, unit, row};
        });

        // Keyed as Sounds.
        this._sounds = [
            ['workToShortRest', _('Work → short rest')],
            ['shortRestToWork', _('Short rest → work')],
            ['workToLongRest', _('Work → long rest')],
            ['longRestToWork', _('Long rest → work')],
        ].map(([transition, title]) => {
            const row = new Adw.ComboRow({title, model: new Gtk.StringList()});
            const preview = new Gtk.Button({label: _('Preview'), valign: Gtk.Align.CENTER});
            row.add_suffix(preview);
            this.group.add(row);
            const sound = {transition, row};
            row.connect('notify::selected', () => this._chooseSound(sound));
            preview.connect('clicked', () => this._previewSound(sound));
            return sound;
        });

        this._sync(null);
    }

    /**
     * Follows the service and asks it to read the lengths from the server
     * again. Returns the handler ids to disconnect when the window closes.
     *
     * @param {Gio.DBusProxy} proxy
     * @returns {number[]}
     */
    setProxy(proxy) {
        this._proxy = proxy;
        const signals = [
            proxy.connect('g-properties-changed', (_source, changed) => this._sync(changed.deepUnpack())),
            proxy.connect('notify::g-name-owner', () => this._sync(null)),
        ];
        this._sync(null);
        // A failed read shows in PomodoroLengthErrors.
        proxy.RefreshPreferencesRemote(() => {});
        return signals;
    }

    // The property's cached value, or the fallback while the service is gone.
    _property(name, fallback) {
        if (!this._proxy?.g_name_owner)
            return fallback;
        const value = this._proxy.get_cached_property(name);
        return value ? value.recursiveUnpack() : fallback;
    }

    // changed holds the properties that changed, or is null to show them all.
    _sync(changed) {
        this._syncLengths(changed === null || 'PomodoroLengths' in changed);
        this._syncSounds();
    }

    _syncLengths(refill) {
        const owned = Boolean(this._proxy?.g_name_owner);
        const editable = this._property('PomodoroLengthsEditable', false);
        const lengths = this._property('PomodoroLengths', {});
        const errors = this._property('PomodoroLengthErrors', {});
        for (const {key, unit, row} of this._lengths) {
            // Typed lengths stay until the service has new ones, so a refused
            // save keeps them. Rows that cannot be saved show the known ones.
            if ((refill || !editable) && key in lengths)
                row.value = lengths[key];
            row.sensitive = editable;
            row.subtitle = errors[key] || unit;
            if (errors[key])
                row.add_css_class('error');
            else
                row.remove_css_class('error');
        }
        this._save.sensitive = editable && !this._saving;

        let description = _('Lengths are saved to your Tokkl account, sounds on this computer.');
        if (!owned)
            description = _('The Pomodoro settings need the timer service.');
        else if (!editable)
            description = _('Changing the lengths needs a connection to the Tokkl server. These are the last known values.');
        this.group.description = errors.general ? `${description}\n${errors.general}` : description;
    }

    _syncSounds() {
        const choices = this._property('SoundChoices', []);
        const chosen = this._property('Sounds', {});
        const key = JSON.stringify(choices);
        this._syncing = true;
        try {
            if (key !== this._choicesKey) {
                this._choicesKey = key;
                this._soundIds = choices.map(choice => choice.id);
                for (const {row} of this._sounds)
                    row.model = Gtk.StringList.new(choices.map(choice => choice.label));
            }
            for (const {transition, row} of this._sounds) {
                const index = this._soundIds.indexOf(chosen[transition]);
                row.selected = index < 0 ? Gtk.INVALID_LIST_POSITION : index;
                row.sensitive = this._soundIds.length > 0;
            }
        } finally {
            this._syncing = false;
        }
    }

    _saveLengths() {
        if (!this._proxy)
            return;
        const values = this._lengths.map(({row}) => {
            // Takes in a number that is still being typed.
            row.update();
            return Math.round(row.value);
        });
        const known = this._property('PomodoroLengths', {});
        const unchanged = this._lengths.every(({key}, index) => known[key] === values[index]);
        this._saving = true;
        this._save.sensitive = false;
        this._proxy.SetPomodoroLengthsRemote(...values, (result, error) => {
            this._saving = false;
            this._syncLengths(false);
            if (error)
                this._toastError(error);
            else if (result[0])
                this._toast(_('Sent to the Tokkl server'));
            else
                this._toast(unchanged ? _('No length changed') : _('Not sent: no connection to the Tokkl server, or a save is still running'));
        });
    }

    _chooseSound({transition, row}) {
        const soundId = this._soundIds[row.selected];
        if (this._syncing || !this._proxy || soundId === undefined)
            return;
        this._proxy.SetSoundRemote(transition, soundId, (result, error) => {
            if (!error && result[0])
                return;
            if (error)
                this._toastError(error);
            else
                this._toast(_('The sound choice could not be saved'));
            // Back to the stored choice.
            this._syncSounds();
        });
    }

    _previewSound({row}) {
        const soundId = this._soundIds[row.selected];
        if (!this._proxy || soundId === undefined)
            return;
        this._proxy.PreviewSoundRemote(soundId, (result, error) => {
            if (error)
                this._toastError(error);
            else if (!result[0])
                this._toast(_('The timer service could not play the sound'));
        });
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title}));
    }

    _toastError(error) {
        Gio.DBusError.strip_remote_error(error);
        this._window.add_toast(new Adw.Toast({title: error.message, timeout: 0}));
    }
}

export default class TokklPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('Connection'),
            icon_name: 'network-server-symbolic',
        });
        window.add(page);

        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        const monochrome = new Adw.SwitchRow({
            title: _('Use a monochrome panel icon'),
            subtitle: _("Follows the panel's text color automatically."),
        });
        settings.bind('monochrome-icon', monochrome, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(monochrome);
        page.add(appearance);

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

        const pomodoro = new PomodoroGroup(window);
        page.add(pomodoro.group);

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
                ...pomodoro.setProxy(proxy),
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
