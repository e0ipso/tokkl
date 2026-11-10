// Connect sends the settings to tokkl-timerd's Configure, which keeps the
// secret in the keyring. Only accepted non-secret values reach GSettings.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { isInsecureUrl } from './instanceurl.js';
import {
    AUTH_MODES,
    describeStatus,
    interfaceVersion,
    outdatedServiceText,
    serviceOutdated,
    serviceRunning,
    supportedProperty,
} from './timer1.js';
import { createTimer1Proxy } from './timer1proxy.js';
import { TypedSecret, connectionIdentity } from './typedsecret.js';

function toastError(window, error) {
    Gio.DBusError.strip_remote_error(error);
    window.add_toast(new Adw.Toast({ title: error.message, timeout: 0 }));
}

class PomodoroGroup {
    constructor(window) {
        this._window = window;
        this._proxy = null;
        this._saving = false;
        this._syncing = false;
        this._soundIds = [];
        this._choicesKey = '';

        this.group = new Adw.PreferencesGroup({ title: _('Pomodoro') });
        this._save = new Gtk.Button({ label: _('Save lengths'), valign: Gtk.Align.CENTER });
        this._save.connect('clicked', () => this._saveLengths());
        this.group.header_suffix = this._save;

        // Ranges and defaults come from PomodoroLengthLimits. Until the service is
        // reached a row has no range and stays insensitive.
        const minutes = _('Minutes');
        this._lengths = [
            ['work', _('Work'), minutes],
            ['shortRest', _('Short rest'), minutes],
            ['longRest', _('Long rest'), minutes],
            ['longRestEvery', _('Long rest every'), _('Pomodoros')],
        ].map(([key, title, unit]) => {
            const row = new Adw.SpinRow({
                title,
                subtitle: unit,
                numeric: true,
                sensitive: false,
                adjustment: new Gtk.Adjustment({ step_increment: 1, page_increment: 5 }),
            });
            this.group.add(row);
            return { key, unit, row };
        });

        this._sounds = [
            ['workToShortRest', _('Work → short rest')],
            ['shortRestToWork', _('Short rest → work')],
            ['workToLongRest', _('Work → long rest')],
            ['longRestToWork', _('Long rest → work')],
        ].map(([transition, title]) => {
            const row = new Adw.ComboRow({ title, model: new Gtk.StringList() });
            const preview = new Gtk.Button({ label: _('Preview'), valign: Gtk.Align.CENTER });
            row.add_suffix(preview);
            this.group.add(row);
            const sound = { transition, row };
            row.connect('notify::selected', () => this._chooseSound(sound));
            preview.connect('clicked', () => this._previewSound(sound));
            return sound;
        });

        this._sync(null);
    }

    setProxy(proxy) {
        this._proxy = proxy;
        const signals = [
            proxy.connect('g-properties-changed', (_source, changed) => this._sync(changed.deepUnpack())),
            proxy.connect('notify::g-name-owner', () => this._sync(null)),
        ];
        this._sync(null);
        // A failed read shows in PomodoroLengthErrors.
        if (!serviceOutdated(proxy)) proxy.RefreshPreferencesRemote(() => {});
        return signals;
    }

    _property(name, fallback) {
        return supportedProperty(this._proxy, name, fallback);
    }

    // changed is null to show every property. A new InterfaceVersion can change
    // which properties are usable.
    _sync(changed) {
        if (changed !== null && 'InterfaceVersion' in changed) changed = null;
        if (changed === null || 'PomodoroLengthLimits' in changed) this._syncLimits();
        this._syncLengths(changed === null || 'PomodoroLengths' in changed);
        this._syncSounds();
    }

    _syncLimits() {
        const limits = this._property('PomodoroLengthLimits', {});
        const lengths = this._property('PomodoroLengths', {});
        for (const { key, row } of this._lengths) {
            const limit = limits[key];
            if (!limit) continue;
            row.adjustment.lower = limit.min;
            row.adjustment.upper = limit.max;
            if (!(key in lengths)) row.value = limit.default;
        }
    }

    _syncLengths(refill) {
        const owned = serviceRunning(this._proxy);
        const editable = this._property('PomodoroLengthsEditable', false);
        const lengths = this._property('PomodoroLengths', {});
        const errors = this._property('PomodoroLengthErrors', {});
        for (const { key, unit, row } of this._lengths) {
            // Typed lengths stay until the service has new ones, so a refused save keeps
            // them. Rows that cannot be saved show the known values.
            if ((refill || !editable) && key in lengths) row.value = lengths[key];
            row.sensitive = editable;
            row.subtitle = errors[key] || unit;
            if (errors[key]) row.add_css_class('error');
            else row.remove_css_class('error');
        }
        this._save.sensitive = editable && !this._saving;

        let description = _('Lengths are saved to your Tokkl account, sounds on this computer.');
        if (!owned) description = _('The Pomodoro settings need the timer service.');
        else if (serviceOutdated(this._proxy)) description = outdatedServiceText(_);
        else if (!editable)
            description = _(
                'Changing the lengths needs a connection to the Tokkl server. These are the last known values.',
            );
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
                for (const { row } of this._sounds) row.model = Gtk.StringList.new(choices.map(choice => choice.label));
            }
            for (const { transition, row } of this._sounds) {
                const index = this._soundIds.indexOf(chosen[transition]);
                row.selected = index < 0 ? Gtk.INVALID_LIST_POSITION : index;
                row.sensitive = this._soundIds.length > 0;
            }
        } finally {
            this._syncing = false;
        }
    }

    _saveLengths() {
        if (!this._proxy || serviceOutdated(this._proxy)) return;
        const values = this._lengths.map(({ row }) => {
            // Commits a number that is still being typed.
            row.update();
            return Math.round(row.value);
        });
        const known = this._property('PomodoroLengths', {});
        const unchanged = this._lengths.every(({ key }, index) => known[key] === values[index]);
        this._saving = true;
        this._save.sensitive = false;
        this._proxy.SetPomodoroLengthsRemote(...values, (result, error) => {
            this._saving = false;
            this._syncLengths(false);
            if (error) this._toastError(error);
            else if (result[0]) this._toast(_('Sent to the Tokkl server'));
            else
                this._toast(
                    unchanged
                        ? _('No length changed')
                        : _('Not sent: no connection to the Tokkl server, or a save is still running'),
                );
        });
    }

    _chooseSound({ transition, row }) {
        const soundId = this._soundIds[row.selected];
        if (this._syncing || !this._proxy || serviceOutdated(this._proxy) || soundId === undefined) return;
        this._proxy.SetSoundRemote(transition, soundId, (result, error) => {
            if (!error && result[0]) return;
            if (error) this._toastError(error);
            else this._toast(_('The sound choice could not be saved'));
            this._syncSounds();
        });
    }

    _previewSound({ row }) {
        const soundId = this._soundIds[row.selected];
        if (!this._proxy || serviceOutdated(this._proxy) || soundId === undefined) return;
        this._proxy.PreviewSoundRemote(soundId, (result, error) => {
            if (error) this._toastError(error);
            else if (!result[0]) this._toast(_('The timer service could not play the sound'));
        });
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({ title }));
    }

    _toastError(error) {
        toastError(this._window, error);
    }
}

function appearanceGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: _('Appearance') });
    const monochrome = new Adw.SwitchRow({
        title: _('Use a monochrome panel icon'),
        subtitle: _("Follows the panel's text color automatically."),
    });
    settings.bind('monochrome-icon', monochrome, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(monochrome);
    return group;
}

class StatusGroup {
    constructor() {
        this._row = new Adw.ActionRow({ title: _('Timer service') });
        this._row.subtitle = _('Connecting to the timer service…');
        this.group = new Adw.PreferencesGroup();
        this.group.add(this._row);
        this._proxy = null;
    }

    setProxy(proxy) {
        this._proxy = proxy;
        const signals = [
            proxy.connect('g-properties-changed', () => this._sync()),
            proxy.connect('notify::g-name-owner', () => this._sync()),
        ];
        this._sync();
        return signals;
    }

    showError(error) {
        this._row.subtitle = error.message;
    }

    _sync() {
        const owned = serviceRunning(this._proxy);
        const words = describeStatus(
            owned ? this._proxy.Status : null,
            owned ? this._proxy.ErrorString : '',
            _,
            interfaceVersion(this._proxy),
        );
        this._row.subtitle = words.detail ? `${words.text}: ${words.detail}` : words.text;
    }
}

class ConnectionGroup {
    constructor(window, settings) {
        this._window = window;
        this._settings = settings;
        this._proxy = null;
        this._configuring = false;

        this.group = new Adw.PreferencesGroup({
            title: _('Tokkl instance'),
            description: _(
                'tokkl-timerd keeps the token or password in the keyring. Leave it empty to keep the saved one.',
            ),
        });
        this._url = new Adw.EntryRow({
            title: _('Instance URL'),
            text: settings.get_string('instance-url'),
            input_purpose: Gtk.InputPurpose.URL,
        });
        this.group.add(this._url);

        // Same words as the KDE and macOS plain-http warning.
        this._insecure = new Adw.ActionRow({
            title: _('This address uses plain http. Your token or password would be sent unencrypted.'),
            title_lines: 0,
            use_markup: false,
            css_classes: ['warning'],
        });
        this._insecure.add_prefix(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
        this.group.add(this._insecure);
        this._url.connect('changed', () => this._syncInsecure());
        this._syncInsecure();

        this._modes = new Adw.ComboRow({
            title: _('Sign in with'),
            model: Gtk.StringList.new([_('API token'), _('Email and password')]),
        });
        this._modes.selected = Math.max(0, AUTH_MODES.indexOf(settings.get_string('auth-mode')));
        this.group.add(this._modes);

        this._email = new Adw.EntryRow({
            title: _('Email'),
            text: settings.get_string('email'),
            input_purpose: Gtk.InputPurpose.EMAIL,
        });
        this.group.add(this._email);

        this._secret = new Adw.PasswordEntryRow();
        this.group.add(this._secret);

        // A secret typed for one instance, sign-in method or email is cleared when
        // any of them changes.
        this._typedSecret = new TypedSecret();
        this._secret.connect('changed', () => this._typedSecret.edited(this._secret.text, this._identity()));
        this._url.connect('changed', () => this._dropStaleSecret());
        this._email.connect('changed', () => this._dropStaleSecret());

        this._modes.connect('notify::selected', () => {
            this._syncMode();
            this._dropStaleSecret();
        });
        this._syncMode();

        this._connect = new Gtk.Button({
            label: _('Connect'),
            halign: Gtk.Align.END,
            css_classes: ['suggested-action'],
        });
        this._connect.connect('clicked', () => this._configure());
        this.buttonGroup = new Adw.PreferencesGroup();
        this.buttonGroup.add(this._connect);
    }

    setProxy(proxy) {
        this._proxy = proxy;
        const signals = [
            proxy.connect('g-properties-changed', () => this._syncSensitive()),
            proxy.connect('notify::g-name-owner', () => this._syncSensitive()),
        ];
        this._syncSensitive();
        return signals;
    }

    _syncSensitive() {
        const usable = !serviceOutdated(this._proxy);
        for (const row of [this._url, this._modes, this._email, this._secret]) row.sensitive = usable;
        this._connect.sensitive = usable && !this._configuring;
    }

    _syncMode() {
        const password = AUTH_MODES[this._modes.selected] === 'password';
        this._email.visible = password;
        this._secret.title = password ? _('Password') : _('API token');
    }

    _syncInsecure() {
        this._insecure.visible = isInsecureUrl(this._url.text);
    }

    _identity() {
        return connectionIdentity(this._url.text, AUTH_MODES[this._modes.selected], this._email.text);
    }

    _dropStaleSecret() {
        if (this._typedSecret.staleFor(this._secret.text, this._identity())) this._secret.text = '';
    }

    _configure() {
        if (!this._proxy || serviceOutdated(this._proxy)) return;
        const mode = AUTH_MODES[this._modes.selected];
        const values = { url: this._url.text.trim(), mode, email: this._email.text.trim() };
        this._configuring = true;
        this._syncSensitive();
        const address = mode === 'password' ? values.email : '';
        this._proxy.ConfigureRemote(values.url, mode, address, this._secret.text, (result, error) => {
            this._configuring = false;
            this._syncSensitive();
            // A call that a later one superseded (org.tokkl.Timer1.Error.Superseded)
            // errors, so only settings the service applied are kept.
            if (error) {
                toastError(this._window, error);
                return;
            }
            this._settings.set_string('instance-url', values.url);
            this._settings.set_string('auth-mode', values.mode);
            this._settings.set_string('email', values.email);
            this._secret.text = '';
            this._window.add_toast(new Adw.Toast({ title: _('Sent to the timer service') }));
        });
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

        const status = new StatusGroup();
        const connection = new ConnectionGroup(window, settings);
        const pomodoro = new PomodoroGroup(window);
        page.add(appearanceGroup(settings));
        page.add(status.group);
        page.add(connection.group);
        page.add(connection.buttonGroup);
        page.add(pomodoro.group);

        const cancellable = new Gio.Cancellable();
        createTimer1Proxy(
            cancellable,
            proxy => {
                const signals = [...status.setProxy(proxy), ...connection.setProxy(proxy), ...pomodoro.setProxy(proxy)];
                window.connect('close-request', () => {
                    signals.forEach(id => proxy.disconnect(id));
                    return false;
                });
            },
            error => status.showError(error),
        );
        window.connect('close-request', () => {
            cancellable.cancel();
            return false;
        });
    }
}
