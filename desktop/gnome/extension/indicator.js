// The top bar button and its menu. Everything shown comes from the
// org.tokkl.Timer1 proxy; every action is one method call on it, and the
// service decides whether it happens.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {describeIndicator, fillColor, pulseOpacity, PULSE_PERIOD_MS, shapeGeometry} from './projectindicator.js';
import {
    chosenProjectLabel,
    countdown,
    describeStatus,
    elapsedSeconds,
    formatElapsed,
    nextPhaseLabel,
    pomodoroModeLabel,
    projectLabel,
    sessionLine,
} from './timer1.js';

// The project indicator in a slot of its own; projectindicator.js decides
// what it shows. Two drawing areas share the slot, so the fill can pulse
// while the ring or outline above it keeps full opacity.
const TokklProjectIndicator = GObject.registerClass(
class TokklProjectIndicator extends St.Widget {
    _init() {
        super._init({
            style_class: 'tokkl-project-indicator',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._shape = {kind: 'empty', round: false, color: '', pulsing: false, label: ''};
        this._pulse = null;

        this._fill = new St.DrawingArea({x_expand: true, y_expand: true, visible: false});
        this._fill.connect('repaint', area => this._paint(area, true));
        this.add_child(this._fill);
        this._edge = new St.DrawingArea({x_expand: true, y_expand: true, visible: false});
        this._edge.connect('repaint', area => this._paint(area, false));
        this.add_child(this._edge);

        this.connect('style-changed', () => this._repaint());
        this.connect('destroy', () => this._stopPulse());
    }

    get shape() {
        return this._shape;
    }

    /**
     * @param {ReturnType<typeof describeIndicator>} shape
     */
    setShape(shape) {
        this._shape = shape;
        this.accessible_name = shape.label;
        this._fill.visible = shape.kind === 'filled';
        this._edge.visible = shape.kind !== 'empty';
        this._repaint();
        if (shape.pulsing && !this._pulse)
            this._startPulse();
        else if (!shape.pulsing)
            this._stopPulse();
    }

    _repaint() {
        this._fill.queue_repaint();
        this._edge.queue_repaint();
    }

    // The timeline follows the fill's frame clock, so it does not advance
    // while the top bar is not on screen.
    _startPulse() {
        this._pulse = new Clutter.Timeline({actor: this._fill, duration: PULSE_PERIOD_MS, repeat_count: -1});
        this._pulse.connect('new-frame', (timeline, elapsedMs) => {
            this._fill.opacity = Math.round(255 * pulseOpacity(elapsedMs));
        });
        this._pulse.start();
    }

    _stopPulse() {
        this._pulse?.stop();
        this._pulse = null;
        this._fill.opacity = 255;
    }

    // The ring, the outline and a fill without a project colour take the
    // top bar's text colour.
    _paint(area, fill) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const {x, y, size, radius, line, dash} = shapeGeometry(width, height, this._shape.round, scale);
        const ink = area.get_theme_node().get_foreground_color();

        if (fill) {
            const {red, green, blue} = fillColor(this._shape.color, ink);
            cr.setSourceRGB(red / 255, green / 255, blue / 255);
            shapePath(cr, x, y, size, radius);
            cr.fill();
        } else {
            cr.setSourceRGBA(ink.red / 255, ink.green / 255, ink.blue / 255, ink.alpha / 255);
            cr.setLineWidth(line);
            if (this._shape.kind === 'outline')
                cr.setDash([dash, dash], 0);
            // The stroke stays inside the shape, as a border would.
            shapePath(cr, x + line / 2, y + line / 2, size - line, Math.max(0, radius - line / 2));
            cr.stroke();
        }
        cr.$dispose();
    }
});

function shapePath(cr, x, y, size, radius) {
    cr.newSubPath();
    cr.arc(x + size - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + size - radius, y + size - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + size - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

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
        this._ownGesture = null;
        this._syncing = false;
        this._tickId = 0;

        // The button lays out one child: the logo, the hourglass of Pomodoro
        // mode, the project indicator and the time, in that order. The logo
        // and the hourglass take the top bar's icon size; setHourglass gives
        // the hourglass its picture.
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._logo = new St.Icon({
            gicon: new Gio.FileIcon({file: logo}),
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

        // From GNOME Shell 50 on, PanelMenu.Button opens its menu from a
        // click gesture that takes every button. Primary clicks pause,
        // resume and start here instead, so that gesture is replaced by one
        // that tells the buttons apart. Before 50 the button opens the menu from
        // vfunc_event, which this class overrides below.
        if (this._clickGesture instanceof Clutter.Action) {
            this._clickGesture.set_enabled(false);
            this._ownGesture = new Clutter.ClickGesture({recognize_on_press: true});
            this._ownGesture.connect('recognize', gesture => this._onPress(gesture.get_button()));
            this.add_action(this._ownGesture);
        }

        // From GNOME Shell 51 on, the menu takes Space, Return and Down from
        // a key controller on the button, and vfunc_event never sees them. A
        // controller in the capture phase runs before it, so Space and Return
        // do what a primary click does here; Down still opens the menu.
        if (Clutter.KeyController &&
            this.get_actions().some(action => action instanceof Clutter.KeyController)) {
            const keys = new Clutter.KeyController();
            keys.connect('key-press', controller => {
                const [, symbol] = controller.get_key();
                const [, pressed, latched, locked] = controller.get_state();
                if (!this._isActivateKey(symbol, pressed | latched | locked))
                    return Clutter.EVENT_PROPAGATE;
                this._onPress(Clutter.BUTTON_PRIMARY);
                return Clutter.EVENT_STOP;
            });
            this.add_action_full('tokkl-activate-keys', Clutter.EventPhase.CAPTURE, keys);
        }

        this._buildMenu(openPreferences);
        this._sync();
    }

    setLogo(file) {
        this._logo.gicon = new Gio.FileIcon({file});
    }

    setHourglass(file) {
        this._hourglass.gicon = new Gio.FileIcon({file});
    }

    _buildMenu(openPreferences) {
        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._statusItem);

        // The service's last word on a session, such as a pomodoro too short
        // to save. It stays until the next one.
        this._messageItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._messageItem.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(this._messageItem);

        this._detailItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._detailItem.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(this._detailItem);

        // Start, or Stop while an entry runs or a chain is paused. It never
        // pauses: Stop ends the chain. Pomodoro mode hides it unless a timer
        // runs or is paused, since the service starts no timer then.
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
            if (!this._syncing)
                this._setPomodoroMode(state);
        });
        this.menu.addMenuItem(this._modeItem);

        // Rebuilt by _syncProjects.
        this._projectMenu = new PopupMenu.PopupSubMenuMenuItem('');
        this.menu.addMenuItem(this._projectMenu);

        this._billableItem = new PopupMenu.PopupSwitchMenuItem(_('Billable'), false);
        // From GNOME Shell 50 on the item also emits toggled when _sync sets
        // it, and that must not go back to the service as a choice.
        this._billableItem.connect('toggled', (item, state) => {
            if (!this._syncing)
                this._setBillable(state);
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
            this._proxySignals = [
                proxy.connect('g-properties-changed', () => this._sync()),
                proxy.connect('notify::g-name-owner', () => this._sync()),
            ];
        }
        this._sync();
    }

    _disconnectProxy() {
        for (const id of this._proxySignals)
            this._proxy.disconnect(id);
        this._proxySignals = [];
    }

    // The property's cached value, or the fallback while the service is
    // gone: a proxy without an owner keeps no properties.
    _property(name, fallback) {
        if (!this._proxy?.g_name_owner)
            return fallback;
        const value = this._proxy.get_cached_property(name);
        return value ? value.recursiveUnpack() : fallback;
    }

    _state() {
        const owned = Boolean(this._proxy?.g_name_owner);
        return {
            status: owned ? this._property('Status', 'error') : null,
            errorString: this._property('ErrorString', ''),
            running: this._property('Running', false),
            startTime: this._property('StartTime', 0),
            paused: this._property('Paused', false),
            chainSeconds: this._property('ChainSeconds', 0),
            indicatorState: this._property('IndicatorState', ''),
            indicatorColor: this._property('IndicatorColor', ''),
            projects: this._property('Projects', []),
            chosenProject: this._property('ChosenProject', 0),
            chosenProjectName: this._property('ChosenProjectName', ''),
            billable: this._property('Billable', false),
            pomodoroMode: this._property('PomodoroMode', false),
            modeLocked: this._property('ModeLocked', false),
            sessionActive: this._property('SessionActive', false),
            phase: this._property('Phase', ''),
            plannedEnd: this._property('PlannedEnd', 0),
            pomodoroNumber: this._property('PomodoroNumber', 0),
            longRestEvery: this._property('LongRestEvery', 0),
            nextPhase: this._property('NextPhase', ''),
            sessionMessage: this._property('SessionMessage', ''),
        };
    }

    _sync() {
        const state = this._state();
        const words = describeStatus(state.status, state.errorString, _);
        const ready = state.status === 'ready';
        const timerHeld = state.running || state.paused;

        this._words = words;
        this._running = state.running;
        this._paused = state.paused;
        this._startTime = state.startTime;
        this._chainSeconds = state.chainSeconds;
        this._pomodoroMode = state.pomodoroMode;
        // The panel counts the phase down while a session is active, unless
        // a timer runs or is paused.
        this._session = state.sessionActive && !timerHeld ? state : null;
        this._ticking = state.running || state.sessionActive;
        this._hourglass.visible = state.pomodoroMode;
        this._projectIndicator.setShape(describeIndicator(state, this._settings.enable_animations, _));
        this._updateTime();
        this._syncTick();

        this._messageItem.label.text = state.sessionMessage;
        this._messageItem.visible = state.sessionMessage.length > 0;
        this._detailItem.label.text = words.detail;
        this._detailItem.visible = words.detail.length > 0;

        this._toggleItem.label.text = timerHeld ? _('Stop') : _('Start');
        this._toggleItem.setSensitive(ready);
        this._toggleItem.visible = !state.pomodoroMode || timerHeld;

        this._syncSession(state, timerHeld);
        this._syncProjects(state, ready);

        // Billable stays editable while an entry runs: the service then
        // edits that entry. While paused it shows the paused entry's flag,
        // which the service refuses to change.
        this._syncing = true;
        this._billableItem.setToggleState(state.billable);
        this._syncing = false;
        this._billableItem.setSensitive(ready && !state.paused);
    }

    // The session's items and the mode switch. Which actions apply is the
    // service's call: it refuses the others, and the menu only follows the
    // published state.
    _syncSession(state, timerHeld) {
        this._startSessionItem.visible = state.pomodoroMode && !state.sessionActive && !timerHeld;
        // A session needs an account, but starts while the instance is
        // unreachable.
        this._startSessionItem.setSensitive(state.status !== null && state.status !== 'unconfigured');
        this._nextPhaseItem.label.text = nextPhaseLabel(state.nextPhase, _);
        this._nextPhaseItem.visible = state.sessionActive;
        this._endSessionItem.visible = state.sessionActive;

        this._modeItem.label.text = pomodoroModeLabel(state.modeLocked, _);
        this._syncing = true;
        this._modeItem.setToggleState(state.pomodoroMode);
        this._syncing = false;
        this._modeItem.setSensitive(state.status !== null && !state.modeLocked);
    }

    // Project chooses the project of the next start. The service refuses it
    // while an entry runs or a chain is paused, so the submenu is locked then.
    _syncProjects(state, ready) {
        const chosen = chosenProjectLabel(state.projects, state.chosenProject, state.chosenProjectName, _);
        if (state.running)
            this._projectMenu.label.text = _('Project: %s (locked while running)').format(chosen);
        else if (state.paused)
            this._projectMenu.label.text = _('Project: %s (locked while paused)').format(chosen);
        else
            this._projectMenu.label.text = _('Project: %s').format(chosen);
        this._projectMenu.setSensitive(ready && !state.running && !state.paused);

        const section = this._projectMenu.menu;
        section.removeAll();
        const choices = [{id: 0, label: _('No project')}];
        for (const project of state.projects)
            choices.push({id: project.id, label: projectLabel(project)});
        for (const choice of choices) {
            const item = new PopupMenu.PopupMenuItem(choice.label);
            item.setOrnament(choice.id === state.chosenProject
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._call('SetProject', [choice.id]));
            section.addMenuItem(item);
        }
    }

    // The chain total: what the chain's paused entries stored plus the
    // running entry's own time, frozen while paused.
    _chainTotal() {
        const now = GLib.get_real_time() / 1_000_000;
        const running = this._running ? elapsedSeconds(this._startTime, now) : 0;
        return formatElapsed(this._chainSeconds + running);
    }

    // The time on the button, the menu's status line and the button's
    // accessible name. During a session they show the phase's countdown
    // instead of the timer.
    _updateTime() {
        let timer, status;
        if (this._session) {
            const now = GLib.get_real_time() / 1_000_000;
            this._label.text = `${countdown(this._session.plannedEnd, now).text}${this._words.mark}`;
            timer = status = sessionLine(this._session, now, _);
        } else {
            const elapsed = this._chainTotal();
            this._label.text = `${elapsed}${this._words.mark}`;
            timer = _('Stopped');
            status = this._words.text;
            if (this._running) {
                timer = _('Running %s').format(elapsed);
            } else if (this._paused) {
                timer = _('Paused %s').format(elapsed);
                // While paused the line leads with the chain total, then the
                // connection state, as the KDE and macOS menus do.
                status = _('Paused %s · %s').format(elapsed, this._words.text);
            }
        }
        this._statusItem.label.text = status;

        const parts = [timer];
        if (this._projectIndicator.shape.label)
            parts.push(this._projectIndicator.shape.label);
        parts.push(this._words.text);
        if (this._words.detail)
            parts.push(this._words.detail);
        if (this._pomodoroMode && !this._session)
            parts.push(_('Pomodoro mode'));
        this.accessible_name = parts.join(' · ');
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
    // service decides: with a timer or in Timer mode it pauses, resumes or
    // starts, and in Pomodoro mode it starts a session or confirms a phase
    // that rings. Before the planned end it asks for the menu instead.
    _activate() {
        this._call('Activate', [], action => {
            if (action === 'open-menu' && !this.menu.isOpen)
                this.menu.toggle();
        });
    }

    _startOrStop() {
        this._call(this._running || this._paused ? 'Stop' : 'Start', []);
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
     * Calls a Timer1 method.
     *
     * @param {string} method
     * @param {Array} args
     * @param {(reply: any) => void} [onReply] gets the method's result, or
     *     null when the call failed; not called once the button is gone
     */
    _call(method, args, onReply) {
        if (!this._proxy)
            return;
        this._proxy[`${method}Remote`](...args, (result, error) => {
            if (error)
                console.warn(`Tokkl: ${method} failed: ${error.message}`);
            if (onReply && this._proxy)
                onReply(error ? null : result[0]);
        });
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
        if (symbol !== Clutter.KEY_space && symbol !== Clutter.KEY_Return)
            return false;
        return (modifiers & Clutter.ModifierType.MODIFIER_MASK &
            ~Clutter.ModifierType.LOCK_MASK & ~Clutter.ModifierType.MOD2_MASK) === 0;
    }

    vfunc_event(event) {
        // Before GNOME Shell 51, the event signal, whose handler this is,
        // comes before the key-press-event signal on which PopupMenu opens
        // the menu.
        if (event.type() === Clutter.EventType.KEY_PRESS &&
            this._isActivateKey(event.get_key_symbol(), event.get_state())) {
            this._onPress(Clutter.BUTTON_PRIMARY);
            return Clutter.EVENT_STOP;
        }
        // From 50 on the gesture handles presses, and St.Widget has no
        // event handler to chain up to.
        if (this._ownGesture)
            return Clutter.EVENT_PROPAGATE;
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
});
