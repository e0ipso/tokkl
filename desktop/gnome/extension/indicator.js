// The top bar button and its menu. Everything shown comes from the
// org.tokkl.Timer1 proxy, through menumodel.js; every action is one method
// call on it, and the service decides whether it happens.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { captureActivateKeys, replaceClickGesture } from './compat.js';
import { describeMenu, describeTime, projectChoices } from './menumodel.js';
import { describeIndicator } from './projectindicator.js';
import { TokklProjectIndicator } from './projectindicatorview.js';
import { describeStatus, formatElapsed, projectLabel, supportsService } from './timer1.js';
import { cachedProperty, serviceRunning } from './timer1proxy.js';
import { TimerRequests } from './timerrequests.js';

// The properties the project submenu's items show. A change to any other
// property leaves the items as they are.
const PROJECT_ITEM_PROPERTIES = ['Projects', 'ProjectsIncomplete', 'ChosenProject'];

export const TokklIndicator = GObject.registerClass(
    class TokklIndicator extends PanelMenu.Button {
        /**
         * @param {import('gi://Gio').File} logo the clock logo PNG in the
         *     extension's directory
         * @param {() => void} openPreferences
         */
        _init(logo, openPreferences) {
            super._init(0.5, _('Tokkl timer'));

            this._proxy = null;
            this._proxySignals = [];
            this._requestSignal = 0;
            this._requests = null;
            this._ownGesture = null;
            this._syncing = false;
            this._tickId = 0;
            // Set when a method call fails, or the server refuses a request
            // this menu sent, so the menu says so; the next call clears it.
            this._actionError = '';

            // The button lays out one child: the logo, the hourglass of Pomodoro
            // mode, the project indicator and the time, in that order. The logo
            // and the hourglass take the top bar's icon size; setHourglass gives
            // the hourglass its picture.
            const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
            this._logo = new St.Icon({
                gicon: new Gio.FileIcon({ file: logo }),
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(this._logo);
            this._hourglass = new St.Icon({
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            box.add_child(this._hourglass);
            this._projectIndicator = new TokklProjectIndicator();
            box.add_child(this._projectIndicator);
            this._label = new St.Label({
                text: formatElapsed(0),
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'tokkl-elapsed',
            });
            box.add_child(this._label);
            this.add_child(box);

            // Shell applies org.gnome.desktop.interface enable-animations here.
            this._settings = St.Settings.get();
            this._settingsSignal = this._settings.connect('notify::enable-animations', () => this._sync());

            // Primary clicks pause, resume and start, so the buttons must be
            // told apart: from Shell 50 through a gesture of our own, before it
            // in vfunc_event below. From Shell 51, Space and Return reach us
            // before the menu's key controller takes them.
            this._ownGesture = replaceClickGesture(this, button => this._onPress(button));
            captureActivateKeys(
                this,
                (symbol, modifiers) => this._isActivateKey(symbol, modifiers),
                () => this._onPress(Clutter.BUTTON_PRIMARY),
            );

            this._buildMenu(openPreferences);
            this._sync();
        }

        setLogo(file) {
            this._logo.gicon = new Gio.FileIcon({ file });
        }

        setHourglass(file) {
            this._hourglass.gicon = new Gio.FileIcon({ file });
        }

        _buildMenu(openPreferences) {
            this._statusItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
            this.menu.addMenuItem(this._statusItem);

            // The service's last word on a session, such as a pomodoro too short
            // to save. It stays until the next one.
            this._messageItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
            this._messageItem.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(this._messageItem);

            this._detailItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
            this._detailItem.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(this._detailItem);

            // Start, or Stop while an entry runs or a chain is paused. It never
            // pauses: Stop ends the chain. Pomodoro mode hides it unless a timer
            // runs or is paused, since the service starts no timer then. An
            // active session hides it in either mode: the session owns the
            // timer, whichever device started it.
            this._toggleItem = new PopupMenu.PopupMenuItem(_('Start'));
            this._toggleItem.connect('activate', () => this._startOrStop());
            this.menu.addMenuItem(this._toggleItem);

            // The session's actions; _sync shows the ones the state offers.
            this._startSessionItem = new PopupMenu.PopupMenuItem(_('Start session'));
            this._startSessionItem.connect('activate', () => this._call('StartSession', []));
            this.menu.addMenuItem(this._startSessionItem);
            this._nextPhaseItem = new PopupMenu.PopupMenuItem('');
            this._nextPhaseItem.connect('activate', () => this._call('NextPhase', []));
            this.menu.addMenuItem(this._nextPhaseItem);
            this._endSessionItem = new PopupMenu.PopupMenuItem(_('End session'));
            this._endSessionItem.connect('activate', () => this._call('EndSession', []));
            this.menu.addMenuItem(this._endSessionItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Timer mode or Pomodoro mode. Like Billable below, it must not send
            // back what _sync sets.
            this._modeItem = new PopupMenu.PopupSwitchMenuItem(_('Pomodoro mode'), false);
            this._modeItem.connect('toggled', (item, state) => {
                if (!this._syncing) this._setPomodoroMode(state);
            });
            this.menu.addMenuItem(this._modeItem);

            // Its items are rebuilt by _syncProjectItems.
            this._projectMenu = new PopupMenu.PopupSubMenuMenuItem('');
            this.menu.addMenuItem(this._projectMenu);

            this._billableItem = new PopupMenu.PopupSwitchMenuItem(_('Billable'), false);
            // From GNOME Shell 50 on the item also emits toggled when _sync sets
            // it, and that must not go back to the service as a choice.
            this._billableItem.connect('toggled', (item, state) => {
                if (!this._syncing) this._setBillable(state);
            });
            this.menu.addMenuItem(this._billableItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => openPreferences());
            this.menu.addMenuItem(settingsItem);
        }

        /**
         * Follows a new proxy, or none while the service cannot be reached.
         *
         * @param {import('gi://Gio').DBusProxy | null} proxy
         */
        setProxy(proxy) {
            this._disconnectProxy();
            this._proxy = proxy;
            if (proxy) {
                this._requests = new TimerRequests((method, done) =>
                    proxy[`${method}Remote`]((result, error) => done(error ? null : result, error)),
                );
                this._proxySignals = [
                    proxy.connect('g-properties-changed', (_source, changed) =>
                        this._sync(Object.keys(changed.deepUnpack())),
                    ),
                    proxy.connect('notify::g-name-owner', () => {
                        this._requests.reset();
                        this._sync();
                    }),
                ];
                this._requestSignal = proxy.connectSignal('RequestFinished', (_proxy, _sender, [id, ok, error]) =>
                    this._requests.finished(id, ok, error),
                );
            }
            this._sync();
        }

        _disconnectProxy() {
            for (const id of this._proxySignals) this._proxy.disconnect(id);
            this._proxySignals = [];
            if (this._requestSignal) this._proxy.disconnectSignal(this._requestSignal);
            this._requestSignal = 0;
            this._requests = null;
        }

        _interfaceVersion() {
            return cachedProperty(this._proxy, 'InterfaceVersion', 0);
        }

        // A service owns the name but is older than the extension supports.
        _outdated() {
            return serviceRunning(this._proxy) && !supportsService(this._interfaceVersion());
        }

        // A property of a service the extension can use; the fallback
        // without one, so an older service shows nothing of its own.
        _property(name, fallback) {
            return this._outdated() ? fallback : cachedProperty(this._proxy, name, fallback);
        }

        _state() {
            const owned = serviceRunning(this._proxy);
            return {
                status: owned ? this._property('Status', 'error') : null,
                interfaceVersion: this._interfaceVersion(),
                errorString: this._property('ErrorString', ''),
                running: this._property('Running', false),
                // The start on this machine's clock, so elapsed time matches the
                // other apps when the clocks differ.
                startTime: this._property('LocalStartTime', 0),
                paused: this._property('Paused', false),
                chainSeconds: this._property('ChainSeconds', 0),
                indicatorState: this._property('IndicatorState', ''),
                indicatorColor: this._property('IndicatorColor', ''),
                projects: this._property('Projects', []),
                projectsIncomplete: this._property('ProjectsIncomplete', false),
                chosenProject: this._property('ChosenProject', 0),
                chosenProjectLabel: this._property('ChosenProjectLabel', {}),
                billable: this._property('Billable', false),
                pomodoroMode: this._property('PomodoroMode', false),
                modeLocked: this._property('ModeLocked', false),
                sessionActive: this._property('SessionActive', false),
                canStartSession: this._property('CanStartSession', false),
                phase: this._property('Phase', ''),
                plannedEnd: this._property('PlannedEnd', 0),
                pomodoroNumber: this._property('PomodoroNumber', 0),
                longRestEvery: this._property('LongRestEvery', 0),
                upcomingPhase: this._property('UpcomingPhase', ''),
                sessionMessage: this._property('SessionMessage', ''),
                alarmError: this._property('AlarmError', ''),
                // Which items show and can be chosen.
                actions: this._property('Actions', null),
                // Which parts the time's words show.
                presentation: this._property('Presentation', null),
                actionError: this._actionError,
            };
        }

        /**
         * Shows the service's state.
         *
         * @param {string[]} [changed] the properties that changed; all of them
         *     when left out
         */
        _sync(changed) {
            const state = this._state();
            const words = describeStatus(state.status, state.errorString, _, state.interfaceVersion);

            this._words = words;
            this._time = {
                status: state.status,
                running: state.running,
                paused: state.paused,
                startTime: state.startTime,
                chainSeconds: state.chainSeconds,
                pomodoroMode: state.pomodoroMode,
                // The panel counts the phase down while a session is active, in
                // either mode.
                session: state.sessionActive ? state : null,
                presentation: state.status !== null ? state.presentation : null,
            };
            this._ticking = state.running || state.sessionActive;
            this._hourglass.visible = state.pomodoroMode;
            this._projectIndicator.setShape(describeIndicator(state, this._settings.enable_animations, _));
            this._updateTime();
            this._syncTick();

            const menu = describeMenu(state, words, _);
            showItem(this._messageItem, menu.message);
            showItem(this._detailItem, menu.detail);
            showItem(this._toggleItem, menu.toggle);
            showItem(this._startSessionItem, menu.startSession);
            showItem(this._nextPhaseItem, menu.nextPhase);
            showItem(this._endSessionItem, menu.endSession);
            showItem(this._projectMenu, menu.project);
            if (!changed || changed.some(name => PROJECT_ITEM_PROPERTIES.includes(name))) this._syncProjectItems(state);
            this._syncSwitch(this._modeItem, menu.mode);
            this._syncSwitch(this._billableItem, menu.billable);
        }

        // Sets a switch without sending the value back to the service.
        _syncSwitch(item, shown) {
            this._syncing = true;
            if (shown.text !== undefined) item.label.text = shown.text;
            item.setToggleState(shown.checked);
            this._syncing = false;
            item.setSensitive(shown.sensitive);
        }

        _syncProjectItems(state) {
            const section = this._projectMenu.menu;
            section.removeAll();
            const choices = projectChoices(
                state.projects,
                state.chosenProject,
                projectLabel,
                _,
                state.projectsIncomplete,
            );
            for (const choice of choices) {
                if (choice.note) {
                    const note = new PopupMenu.PopupMenuItem(choice.label, { reactive: false, can_focus: false });
                    note.label.clutter_text.line_wrap = true;
                    section.addMenuItem(note);
                    continue;
                }
                const item = new PopupMenu.PopupMenuItem(choice.label);
                item.setOrnament(choice.checked ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
                item.connect('activate', () => this._call('SetProject', [choice.id]));
                section.addMenuItem(item);
            }
        }

        _updateTime() {
            const now = GLib.get_real_time() / 1_000_000;
            const shown = describeTime(this._time, this._words, this._projectIndicator.shape.label, now, _);
            this._label.text = shown.button;
            this._statusItem.label.text = shown.status;
            this.accessible_name = shown.accessibleName;
        }

        // Ticks once a second while an entry runs or a session is active, and
        // not at all otherwise.
        _syncTick() {
            if (this._ticking && !this._tickId) {
                this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                    this._updateTime();
                    return GLib.SOURCE_CONTINUE;
                });
                GLib.Source.set_name_by_id(this._tickId, '[tokkl] elapsed time');
            } else if (!this._ticking && this._tickId) {
                GLib.source_remove(this._tickId);
                this._tickId = 0;
            }
        }

        // What a primary click and Space or Return on the button do. The
        // service decides: during a session, in either mode, it confirms a phase
        // that rings and otherwise asks for the menu. Without a session, with a
        // timer or in Timer mode it pauses, resumes or starts, and in Pomodoro
        // mode it starts a session.
        _activate() {
            // An older service gets nothing; the menu says to update it.
            if (this._outdated()) {
                if (!this.menu.isOpen) this.menu.toggle();
                return;
            }
            this._call('Activate', [], action => {
                if (action === 'open-menu' && !this.menu.isOpen) this.menu.toggle();
            });
        }

        _startOrStop() {
            this._request(this._time.running || this._time.paused ? 'Stop' : 'Start');
        }

        // The service answers false when it refused a choice, and then announces
        // nothing, so a refused choice puts the switch back to the service's
        // value.
        _setBillable(state) {
            this._call('SetBillable', [state], accepted => accepted || this._sync());
        }

        _setPomodoroMode(state) {
            this._call('SetPomodoroMode', [state], accepted => accepted || this._sync());
        }

        /**
         * Calls a Timer1 method. A failed call, such as one the service never
         * answered, shows a short message in the menu until the next call,
         * and the menu shows the service's last known state again.
         *
         * @param {string} method
         * @param {Array} args
         * @param {(reply: any) => void} [onReply] gets the method's result, or
         *     null when the call failed; not called once the button is gone
         */
        _call(method, args, onReply) {
            if (!this._proxy || this._outdated()) return;
            this._clearActionError();
            this._proxy[`${method}Remote`](...args, (result, error) => {
                if (error) this._callFailed(method, error);
                if (!this._proxy) return;
                if (onReply) onReply(error ? null : result[0]);
            });
        }

        /**
         * Sends Start or Stop as a request this menu follows to its end (see
         * timerrequests.js): when the server refuses it, or its outcome is
         * unknown, the service's words for it show in the menu until the
         * next call, also once ErrorString has moved on.
         *
         * @param {'Start' | 'Stop'} action
         */
        _request(action) {
            if (!this._proxy || this._outdated()) return;
            this._clearActionError();
            this._requests.send(action, {
                sent: (_sent, error) => {
                    if (error) this._callFailed(action, error);
                },
                finished: (ok, error) => {
                    if (!this._proxy || ok || !error) return;
                    this._actionError = error;
                    this._sync([]);
                },
            });
        }

        _clearActionError() {
            if (!this._actionError) return;
            this._actionError = '';
            // Leaves the project items alone: this may run in one's activate.
            this._sync([]);
        }

        _callFailed(method, error) {
            console.warn(`Tokkl: ${method} failed: ${error.message}`);
            if (!this._proxy) return;
            this._actionError = _('The timer service did not answer.');
            this._sync([]);
        }

        // A primary click is the service's Activate (see _activate); other
        // buttons and touch open the menu, whose Stop ends the timer. Space and
        // Return on the focused button do what a primary click does (see
        // _isActivateKey), and Down opens the menu.
        _onPress(button) {
            if (button === Clutter.BUTTON_PRIMARY) {
                this.menu.close();
                this._activate();
            } else {
                this.menu.toggle();
            }
        }

        // Space or Return without a modifier other than Caps Lock and Num Lock,
        // the keys PopupMenu would otherwise take to open the menu.
        _isActivateKey(symbol, modifiers) {
            if (symbol !== Clutter.KEY_space && symbol !== Clutter.KEY_Return) return false;
            return (
                (modifiers &
                    Clutter.ModifierType.MODIFIER_MASK &
                    ~Clutter.ModifierType.LOCK_MASK &
                    ~Clutter.ModifierType.MOD2_MASK) ===
                0
            );
        }

        vfunc_event(event) {
            // Before GNOME Shell 51, the event signal, whose handler this is,
            // comes before the key-press-event signal on which PopupMenu opens
            // the menu.
            if (
                event.type() === Clutter.EventType.KEY_PRESS &&
                this._isActivateKey(event.get_key_symbol(), event.get_state())
            ) {
                this._onPress(Clutter.BUTTON_PRIMARY);
                return Clutter.EVENT_STOP;
            }
            // From 50 on the gesture handles presses, and St.Widget has no
            // event handler to chain up to.
            if (this._ownGesture) return Clutter.EVENT_PROPAGATE;
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                this._onPress(event.get_button());
                return Clutter.EVENT_STOP;
            }
            return super.vfunc_event(event);
        }

        _onDestroy() {
            this._settings.disconnect(this._settingsSignal);
            if (this._tickId) {
                GLib.source_remove(this._tickId);
                this._tickId = 0;
            }
            this._disconnectProxy();
            this._proxy = null;
            super._onDestroy();
        }
    },
);

// Puts what describeMenu() says on a menu item: its text, if it has one, and
// whether it shows and can be chosen.
function showItem(item, shown) {
    if (shown.text !== undefined) item.label.text = shown.text;
    if (shown.visible !== undefined) item.visible = shown.visible;
    if (shown.sensitive !== undefined) item.setSensitive(shown.sensitive);
}
