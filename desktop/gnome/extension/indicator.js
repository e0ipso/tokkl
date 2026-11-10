// The top bar button and menu. Every action is one Timer1 method call, and the
// service decides whether it happens.

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
import {
    describeStatus,
    formatElapsed,
    interfaceVersion,
    projectLabel,
    refreshProjectsOnOpen,
    serviceOutdated,
    serviceRunning,
    supportedProperty,
} from './timer1.js';
import { TimerRequests } from './timerrequests.js';

const PROJECT_ITEM_PROPERTIES = ['Projects', 'ProjectsIncomplete', 'ChosenProject'];

export const TokklIndicator = GObject.registerClass(
    class TokklIndicator extends PanelMenu.Button {
        _init(logo, openPreferences) {
            super._init(0.5, _('Tokkl timer'));

            this._proxy = null;
            this._proxySignals = [];
            this._requestSignal = 0;
            this._requests = null;
            this._ownGesture = null;
            this._syncing = false;
            this._tickId = 0;
            // Holds a failed call or a refused request until the next call.
            this._actionError = '';

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

            // Primary clicks act, so buttons must be told apart: Shell 50 needs our own
            // gesture, and from Shell 51 Space and Return reach us before the menu does.
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

            this._messageItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
            this._messageItem.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(this._messageItem);

            this._detailItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
            this._detailItem.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(this._detailItem);

            // Stop ends the chain; it never pauses.
            this._toggleItem = new PopupMenu.PopupMenuItem(_('Start'));
            this._toggleItem.connect('activate', () => this._startOrStop());
            this.menu.addMenuItem(this._toggleItem);

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

            this._modeItem = new PopupMenu.PopupSwitchMenuItem(_('Pomodoro mode'), false);
            this._modeItem.connect('toggled', (item, state) => {
                if (!this._syncing) this._setPomodoroMode(state);
            });
            this.menu.addMenuItem(this._modeItem);

            this._projectMenu = new PopupMenu.PopupSubMenuMenuItem('');
            this.menu.addMenuItem(this._projectMenu);

            this._billableItem = new PopupMenu.PopupSwitchMenuItem(_('Billable'), false);
            // From GNOME Shell 50 the item also emits toggled when _sync sets it.
            this._billableItem.connect('toggled', (item, state) => {
                if (!this._syncing) this._setBillable(state);
            });
            this.menu.addMenuItem(this._billableItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => openPreferences());
            this.menu.addMenuItem(settingsItem);

            // Projects have no stream, so each opening checks them. Returning true here
            // would stop the Shell's own handlers.
            this.menu.connect('open-state-changed', (_menu, open) => {
                refreshProjectsOnOpen(open, this._proxy);
            });
        }

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

        _outdated() {
            return serviceOutdated(this._proxy);
        }

        _property(name, fallback) {
            return supportedProperty(this._proxy, name, fallback);
        }

        _state() {
            const owned = serviceRunning(this._proxy);
            return {
                status: owned ? this._property('Status', 'error') : null,
                interfaceVersion: interfaceVersion(this._proxy),
                errorString: this._property('ErrorString', ''),
                running: this._property('Running', false),
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
                actions: this._property('Actions', null),
                presentation: this._property('Presentation', null),
                actionError: this._actionError,
            };
        }

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

        _activate() {
            if (this._outdated()) {
                if (!this.menu.isOpen) this.menu.toggle();
                return;
            }
            this._call('Activate', [], action => {
                if (action === 'open-menu' && !this.menu.isOpen) this.menu.toggle();
            });
        }

        _startOrStop() {
            this._request(this._property('Actions', null)?.run?.label === 'stop' ? 'Stop' : 'Start');
        }

        // A refused choice is answered false with no property change, so the switch
        // is reset to the service's value.
        _setBillable(state) {
            this._call('SetBillable', [state], accepted => accepted || this._sync());
        }

        _setPomodoroMode(state) {
            this._call('SetPomodoroMode', [state], accepted => accepted || this._sync());
        }

        _call(method, args, onReply) {
            if (!this._proxy || this._outdated()) return;
            this._clearActionError();
            this._proxy[`${method}Remote`](...args, (result, error) => {
                if (error) this._callFailed(method, error);
                if (!this._proxy) return;
                if (onReply) onReply(error ? null : result[0]);
            });
        }

        // The menu shows a refused or unknown outcome until the next call, even
        // after ErrorString has moved on. See timerrequests.js.
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
            // Leaves the project items alone: this may run inside one's activate.
            this._sync([]);
        }

        _callFailed(method, error) {
            console.warn(`Tokkl: ${method} failed: ${error.message}`);
            if (!this._proxy) return;
            this._actionError = _('The timer service did not answer.');
            this._sync([]);
        }

        _onPress(button) {
            if (button === Clutter.BUTTON_PRIMARY) {
                this.menu.close();
                this._activate();
            } else {
                this.menu.toggle();
            }
        }

        // Caps Lock and Num Lock are allowed. PopupMenu would otherwise open on these keys.
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
            // Before GNOME Shell 51 the event signal comes before key-press-event, on
            // which PopupMenu opens the menu.
            if (
                event.type() === Clutter.EventType.KEY_PRESS &&
                this._isActivateKey(event.get_key_symbol(), event.get_state())
            ) {
                this._onPress(Clutter.BUTTON_PRIMARY);
                return Clutter.EVENT_STOP;
            }
            // From Shell 50 the gesture handles presses, and St.Widget has no event
            // handler to chain up to.
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

function showItem(item, shown) {
    if (shown.text !== undefined) item.label.text = shown.text;
    if (shown.visible !== undefined) item.visible = shown.visible;
    if (shown.sensitive !== undefined) item.setSensitive(shown.sensitive);
}
