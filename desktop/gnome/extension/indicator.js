// The top bar button and its menu. Everything shown comes from the
// org.tokkl.Timer1 proxy; every action is one method call on it, and the
// service decides whether it happens.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {describeIndicator, fillColor, pulseOpacity, PULSE_PERIOD_MS, shapeGeometry} from './projectindicator.js';
import {chosenProjectLabel, describeStatus, elapsedSeconds, formatElapsed, projectLabel} from './timer1.js';

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
     * @param {() => void} openPreferences
     */
    _init(openPreferences) {
        super._init(0.5, _('Tokkl timer'));

        this._proxy = null;
        this._proxySignals = [];
        this._ownGesture = null;
        this._syncing = false;
        this._tickId = 0;

        // The button lays out one child.
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
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
        // click gesture that takes every button. Primary clicks start and
        // stop here instead, so that gesture is replaced by one that tells
        // the buttons apart. Before 50 the button opens the menu from
        // vfunc_event, which this class overrides below.
        if (this._clickGesture instanceof Clutter.Action) {
            this._clickGesture.set_enabled(false);
            this._ownGesture = new Clutter.ClickGesture({recognize_on_press: true});
            this._ownGesture.connect('recognize', gesture => this._onPress(gesture.get_button()));
            this.add_action(this._ownGesture);
        }

        this._buildMenu(openPreferences);
        this._sync();
    }

    _buildMenu(openPreferences) {
        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._statusItem);

        this._detailItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._detailItem.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(this._detailItem);

        this._toggleItem = new PopupMenu.PopupMenuItem(_('Start'));
        this._toggleItem.connect('activate', () => this._toggleTimer());
        this.menu.addMenuItem(this._toggleItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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
            indicatorState: this._property('IndicatorState', ''),
            indicatorColor: this._property('IndicatorColor', ''),
            projects: this._property('Projects', []),
            chosenProject: this._property('ChosenProject', 0),
            billable: this._property('Billable', false),
        };
    }

    _sync() {
        const state = this._state();
        const words = describeStatus(state.status, state.errorString, _);
        const ready = state.status === 'ready';

        this._words = words;
        this._running = state.running;
        this._startTime = state.startTime;
        this._projectIndicator.setShape(describeIndicator(state, this._settings.enable_animations, _));
        this._updateElapsed();
        this._syncTick();

        this._statusItem.label.text = words.text;
        this._detailItem.label.text = words.detail;
        this._detailItem.visible = words.detail.length > 0;

        this._toggleItem.label.text = state.running ? _('Stop') : _('Start');
        this._toggleItem.setSensitive(ready);

        this._syncProjects(state, ready);

        // Billable stays editable while an entry runs: the service then
        // edits that entry.
        this._syncing = true;
        this._billableItem.setToggleState(state.billable);
        this._syncing = false;
        this._billableItem.setSensitive(ready);
    }

    // Project chooses the project of the next start. The service refuses it
    // while an entry runs, so the submenu is locked then.
    _syncProjects(state, ready) {
        const chosen = chosenProjectLabel(state.projects, state.chosenProject, _);
        this._projectMenu.label.text = state.running
            ? _('Project: %s (locked while running)').format(chosen)
            : _('Project: %s').format(chosen);
        this._projectMenu.setSensitive(ready && !state.running);

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

    _updateElapsed() {
        const now = GLib.get_real_time() / 1_000_000;
        const elapsed = formatElapsed(this._running ? elapsedSeconds(this._startTime, now) : 0);
        this._label.text = `${elapsed}${this._words.mark}`;

        const parts = [this._running ? _('Running %s').format(elapsed) : _('Stopped')];
        if (this._projectIndicator.shape.label)
            parts.push(this._projectIndicator.shape.label);
        parts.push(this._words.text);
        if (this._words.detail)
            parts.push(this._words.detail);
        this.accessible_name = parts.join(' · ');
    }

    // Ticks once a second while an entry runs, and not at all otherwise.
    _syncTick() {
        if (this._running && !this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._updateElapsed();
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(this._tickId, '[tokkl] elapsed time');
        } else if (!this._running && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _toggleTimer() {
        this._call(this._running ? 'Stop' : 'Start', []);
    }

    _setBillable(state) {
        // A refused choice puts the switch back to the service's value.
        this._call('SetBillable', [state], () => this._sync());
    }

    /**
     * Calls a Timer1 method. The service answers false when it refused, and
     * then announces nothing, so onRefused can restore what the menu shows.
     *
     * @param {string} method
     * @param {Array} args
     * @param {() => void} [onRefused]
     */
    _call(method, args, onRefused) {
        if (!this._proxy)
            return;
        this._proxy[`${method}Remote`](...args, (result, error) => {
            if (error)
                console.warn(`Tokkl: ${method} failed: ${error.message}`);
            if ((error || !result?.[0]) && onRefused && this._proxy)
                onRefused();
        });
    }

    // A primary click starts or stops; other buttons and touch open the
    // menu. Keyboard users get the menu too: PopupMenu opens it on Space,
    // Return or Down, and Start or Stop is its first item they can choose.
    _onPress(button) {
        if (button === Clutter.BUTTON_PRIMARY) {
            this.menu.close();
            this._toggleTimer();
        } else {
            this.menu.toggle();
        }
    }

    vfunc_event(event) {
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
