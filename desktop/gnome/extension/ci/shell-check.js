// Drives the installed extension inside a running GNOME Shell against
// mock-timer.js and reports every step that fails. shell-driver.js has the
// helpers that read and operate the panel button.
//
//   gjs -m shell-check.js UUID MOCK_TIMER_JS TIMER1_XML

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {exit, programArgs} from 'system';
import {call, contrastRatio, delay, panelButton, shell, steps, waitFor, waitForEnabled} from './shell-driver.js';
import {formatElapsed} from '../timer1.js';

const [uuid, mockTimer, timer1Xml] = programArgs;

const mockCalls = () => JSON.parse(call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Calls',
    null, '(s)')[0]);
const mockSet = (name, value) => call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Set',
    new GLib.Variant('(sv)', [name, value]), null);

const checks = steps();
const {step} = checks;
const {button, label, menuOpen, sensitive, indicator, pointAtButton, click, press} = panelButton(uuid);
const lastCall = () => mockCalls().at(-1) ?? [];
const timerProperty = name => call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.freedesktop.DBus.Properties', 'Get',
    new GLib.Variant('(ss)', ['org.tokkl.Timer1', name]), '(v)')[0];
// The chain total the label should show now.
const chainTotal = () => {
    const start = timerProperty('StartTime');
    const running = timerProperty('Running') && start > 0 ? Math.floor(Date.now() / 1000) - start : 0;
    return formatElapsed(timerProperty('ChainSeconds') + running);
};
const toggleItem = () => shell(`${button}._toggleItem.label.text`);
const statusLine = () => shell(`${button}._statusItem.label.text`);
// Waits until the calls since count are exactly the one method, pressing
// the key again only when nothing arrived: the first key of a new virtual
// keyboard can be lost while the seat adds the device.
const pressFor = async (key, method) => {
    const count = mockCalls().length;
    for (let attempt = 1; ; attempt++) {
        press(key);
        try {
            await waitFor(`${method} from ${key}`, () => mockCalls().length > count, 2000);
            break;
        } catch (error) {
            if (attempt === 5)
                throw error;
        }
    }
    await delay(300);
    const sent = mockCalls().slice(count);
    if (JSON.stringify(sent) !== JSON.stringify([[method]]))
        throw new Error(`${key} sent ${JSON.stringify(sent)}, not ${method}`);
    if (menuOpen())
        throw new Error(`${key} opened the menu`);
};
const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
const setInterface = (method, key, value) => {
    interfaceSettings[method](key, value);
    Gio.Settings.sync();
};

// Waits until the indicator matches every field of expected.
const indicatorIs = (what, expected) => waitFor(what, () => {
    const shown = indicator();
    return Object.entries(expected).every(([key, value]) => shown[key] === value) || shown;
});
let slot = null;
const sameSlot = () => {
    const {width, height} = indicator();
    if (width !== slot.width || height !== slot.height)
        throw new Error(`the slot is ${width}x${height}, not ${slot.width}x${slot.height}`);
};

await step('the extension is enabled without errors', () => waitForEnabled(uuid));

await step('the button shows the packed clock logo, then the project indicator, then the time', async () => {
    const logo = () => shell(`(() => {
        const button = ${button};
        const file = button._logo.gicon.get_file();
        const packed = Main.extensionManager.lookup(${JSON.stringify(uuid)}).dir.get_child('tokkl.png');
        const order = button._logo.get_parent().get_children().map(child =>
            child === button._logo ? 'logo' : child === button._projectIndicator ? 'indicator'
                : child === button._label ? 'time' : child.constructor.name);
        // The icon keeps its size when the PNG does not decode; only its
        // child's image content shows that the picture loaded.
        const image = button._logo.get_first_child()?.content;
        const decoded = image instanceof imports.gi.St.ImageContent;
        const [, imageWidth, imageHeight] = decoded ? image.get_preferred_size() : [false, 0, 0];
        return {
            packed: file.equal(packed) && packed.query_exists(null),
            path: packed.get_path(),
            styleClass: button._logo.style_class,
            visible: button._logo.visible,
            drawn: button._logo.get_n_children(),
            width: button._logo.width,
            height: button._logo.height,
            decoded,
            imageWidth,
            imageHeight,
            order,
        };
    })()`);
    const shown = logo();
    if (!shown.packed)
        throw new Error(`the logo is not ${shown.path}: ${JSON.stringify(shown)}`);
    if (JSON.stringify(shown.order) !== JSON.stringify(['logo', 'indicator', 'time']))
        throw new Error(`order: ${JSON.stringify(shown.order)}`);
    // GNOME Shell can enable the extension while it is still starting up,
    // before the top bar is shown, and the logo is drawn only after that.
    await waitFor('the drawn logo', () => {
        const now = logo();
        return (now.styleClass === 'system-status-icon' && now.visible && now.drawn === 1 &&
            now.width > 0 && now.height > 0 &&
            now.decoded && now.imageWidth > 0 && now.imageHeight > 0) || now;
    });
    // The installed image is the one in the checkout.
    const [, installed] = GLib.file_get_contents(shown.path);
    const [ci] = GLib.filename_from_uri(import.meta.url);
    const [, source] = GLib.file_get_contents(GLib.build_filenamev([GLib.path_get_dirname(ci), '..', 'tokkl.png']));
    if (GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, installed) !==
        GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, source))
        throw new Error(`${shown.path} differs from the extension's tokkl.png`);
});

await step('without the service the button says it is not running', async () => {
    await waitFor('the mark', () => label() === '0:00!' || label());
    const status = shell(`${button}._statusItem.label.text`);
    if (status !== 'Timer service not running')
        throw new Error(`status: ${status}`);
});

await step('without the service the indicator slot is empty and unnamed', async () => {
    await indicatorIs('an empty slot', {kind: 'empty', fillShown: false, edgeShown: false, accessibleName: ''});
    slot = indicator();
    if (!(slot.width > 0 && slot.height > 0))
        throw new Error(`the slot is ${slot.width}x${slot.height}`);
});

await step('the button follows a service that starts later', async () => {
    Gio.Subprocess.new(['gjs', '-m', mockTimer, timer1Xml], Gio.SubprocessFlags.NONE);
    await waitFor('the ready time', () => label() === '0:00' || label());
});

await step('no project is a dashed square outline named No project', async () => {
    await indicatorIs('an outline', {kind: 'outline', round: false, fillShown: false, edgeShown: true,
        accessibleName: 'No project', pulsing: false});
    sameSlot();
    const name = shell(`${button}.accessible_name`);
    if (!name.includes('No project'))
        throw new Error(`button name: ${name}`);
});

await step('a primary click starts the timer through the service', async () => {
    await pointAtButton();
    const before = mockCalls().length;
    click(1);
    await waitFor('Start', () => mockCalls().length > before && lastCall()[0] === 'Start' || mockCalls());
    if (menuOpen())
        throw new Error('the click opened the menu');
});

await step('the panel shows the elapsed time from StartTime', async () => {
    // 1:02:55 ago, so the label moves to the next minute within seconds.
    const start = Math.floor(Date.now() / 1000) - 3775;
    mockSet('StartTime', new GLib.Variant('x', start));
    await waitFor('1:02 or 1:03', () => /^1:0[23]$/.test(label()) || label());
    await waitFor('the next minute', () => label() === '1:03' || label(), 8000);
});

await step('a running entry without a project is a round outline that does not pulse', async () => {
    await indicatorIs('a round outline', {kind: 'outline', round: true, pulsing: false, fillShown: false,
        edgeShown: true});
    sameSlot();
});

await step('the project is locked while running, billable is not', async () => {
    await waitFor('locked project', () => sensitive('_projectMenu') === false);
    if (!sensitive('_billableItem'))
        throw new Error('billable is insensitive while running');
    const before = mockCalls().length;
    shell(`${button}._billableItem.toggle()`);
    await waitFor('SetBillable', () => mockCalls().length > before && lastCall()[0] === 'SetBillable' &&
        lastCall()[1] === true || mockCalls());
    await waitFor('the switch', () => shell(`${button}._billableItem.state`) === true);
});

await step('a second primary click pauses the timer, and the time holds the chain total', async () => {
    const before = mockCalls().length;
    click(1);
    await waitFor('Pause', () => mockCalls().length > before && lastCall()[0] === 'Pause' || mockCalls());
    await waitFor('Paused', () => timerProperty('Paused') === true);
    const total = chainTotal();
    if (!/^1:0[3-9]$/.test(total))
        throw new Error(`the chain holds ${total}`);
    await waitFor('the chain total', () => label() === total || label());
    const name = shell(`${button}.accessible_name`);
    if (!name.startsWith(`Paused ${total} · `))
        throw new Error(`button name: ${name}`);
    if (menuOpen())
        throw new Error('the click opened the menu');
    if (toggleItem() !== 'Stop')
        throw new Error(`the menu offers ${toggleItem()}`);
    if (sensitive('_projectMenu') || sensitive('_billableItem'))
        throw new Error('the project or billable stayed sensitive while paused');
    const title = shell(`${button}._projectMenu.label.text`);
    if (title !== 'Project: No project (locked while paused)')
        throw new Error(`title: ${title}`);
    await delay(1500);
    if (label() !== total)
        throw new Error(`the paused time moved to ${label()}`);
});

await step('a paused timer says Paused with the chain total in the menu status line', async () => {
    const total = chainTotal();
    const paused = `Paused ${total} · Connected`;
    click(3);
    try {
        await waitFor('the menu', () => menuOpen() === true);
        await waitFor('Paused in the status line', () => statusLine() === paused || statusLine());
        // The connection state stays in the line.
        mockSet('Status', new GLib.Variant('s', 'stale'));
        await waitFor('the offline state in the status line',
            () => statusLine() === `Paused ${total} · Offline, showing the last known state` || statusLine());
    } finally {
        mockSet('Status', new GLib.Variant('s', 'ready'));
        // An open menu would take the next click.
        shell(`${button}.menu.close()`);
    }
    await waitFor('Connected in the status line', () => statusLine() === paused || statusLine());
});

await step('a primary click resumes, and the time counts on from the chain total', async () => {
    const before = mockCalls().length;
    click(1);
    await waitFor('Resume', () => mockCalls().length > before && lastCall()[0] === 'Resume' || mockCalls());
    await waitFor('Running', () => timerProperty('Running') === true);
    await waitFor('the chain total', () => label() === chainTotal() || [label(), chainTotal()]);
    if (!/^1:0[3-9]$/.test(label()))
        throw new Error(`the time restarted at ${label()}`);
    const name = shell(`${button}.accessible_name`);
    if (!name.startsWith(`Running ${label()} · `))
        throw new Error(`button name: ${name}`);
    if (toggleItem() !== 'Stop')
        throw new Error(`the menu offers ${toggleItem()}`);
    if (statusLine() !== 'Connected')
        throw new Error(`status: ${statusLine()}`);
});

await step('Stop in the menu ends the chain, and the item then reads Start', async () => {
    const before = mockCalls().length;
    shell(`${button}._toggleItem.activate(null)`);
    await waitFor('Stop', () => mockCalls().length > before && lastCall()[0] === 'Stop' || mockCalls());
    await waitFor('0:00', () => label() === '0:00' || label());
    if (timerProperty('ChainSeconds') !== 0 || timerProperty('Paused'))
        throw new Error('the chain outlived Stop');
    await waitFor('Start', () => toggleItem() === 'Start' || toggleItem());
    if (!shell(`${button}.accessible_name`).startsWith('Stopped · '))
        throw new Error(`button name: ${shell(`${button}.accessible_name`)}`);
});

await step('a stopped timer lets the menu choose the project', async () => {
    await waitFor('unlocked project', () => sensitive('_projectMenu') === true);
    shell(`${button}._projectMenu.menu._getMenuItems()[1].activate(null)`);
    await waitFor('SetProject 7', () => lastCall()[0] === 'SetProject' && lastCall()[1] === 7 || mockCalls());
    await waitFor('the title', () => shell(`${button}._projectMenu.label.text`) === 'Project: Website (Acme)' ||
        shell(`${button}._projectMenu.label.text`));
});

await step('a chosen project fills a still square with its colour', async () => {
    await indicatorIs('a filled square', {kind: 'filled', round: false, color: '#3366cc', pulsing: false,
        fillShown: true, edgeShown: true, fillOpacity: 255, accessibleName: 'Website (Acme)'});
    sameSlot();
    const name = shell(`${button}.accessible_name`);
    if (!name.includes('Website (Acme)'))
        throw new Error(`button name: ${name}`);
});

// GNOME Shell turns animations off when it renders in software, as in these
// containers. The pulse checks lift that for themselves and restore it.
const animations = () => shell('imports.gi.St.Settings.get().enable_animations');
let uninhibited = false;

await step('the running dot pulses its fill, and the ring stays opaque', async () => {
    setInterface('set_boolean', 'enable-animations', true);
    click(1);
    await indicatorIs('a running dot', {kind: 'filled', round: true});
    if (!animations()) {
        if (indicator().pulsing)
            throw new Error('the dot pulses while GNOME Shell has animations off');
        shell('imports.gi.St.Settings.get().uninhibit_animations()');
        uninhibited = true;
    }
    await indicatorIs('a pulsing dot', {kind: 'filled', round: true, pulsing: true});
    await waitFor('a faded fill', () => indicator().fillOpacity < 160 || indicator());
    await waitFor('the fill back up', () => indicator().fillOpacity > 200 || indicator());
    if (indicator().edgeOpacity !== 255)
        throw new Error(`the ring faded: ${JSON.stringify(indicator())}`);
    sameSlot();
});

await step('with enable-animations off the dot stays steady', async () => {
    setInterface('set_boolean', 'enable-animations', false);
    try {
        await indicatorIs('a steady dot', {round: true, pulsing: false, fillOpacity: 255});
        for (let sample = 0; sample < 10; sample++) {
            await delay(100);
            if (indicator().fillOpacity !== 255)
                throw new Error(`the fill moved: ${JSON.stringify(indicator())}`);
        }
    } finally {
        setInterface('reset', 'enable-animations');
    }
    await indicatorIs('the pulse again', {pulsing: true});
});

if (uninhibited)
    shell('imports.gi.St.Settings.get().inhibit_animations()');

await step('a paused timer turns the dot into a still square, and Stop clears the chain', async () => {
    click(1);
    await waitFor('Pause', () => lastCall()[0] === 'Pause' || mockCalls());
    await indicatorIs('a still square', {kind: 'filled', round: false, pulsing: false, fillOpacity: 255});
    const before = mockCalls().length;
    shell(`${button}._toggleItem.activate(null)`);
    await waitFor('Stop', () => mockCalls().length > before && lastCall()[0] === 'Stop' || mockCalls());
    await waitFor('the chain cleared', () => timerProperty('Paused') === false && timerProperty('ChainSeconds') === 0);
    await waitFor('0:00', () => label() === '0:00' || label());
    await waitFor('Start', () => toggleItem() === 'Start' || toggleItem());
    await indicatorIs('the still square', {kind: 'filled', round: false, pulsing: false});
});

await step('a project still being read leaves the slot empty', async () => {
    mockSet('IndicatorColor', new GLib.Variant('s', ''));
    mockSet('IndicatorState', new GLib.Variant('s', 'pending'));
    await indicatorIs('an empty slot', {kind: 'empty', fillShown: false, edgeShown: false});
    sameSlot();
    mockSet('IndicatorState', new GLib.Variant('s', 'project'));
    mockSet('IndicatorColor', new GLib.Variant('s', '#3366cc'));
    await indicatorIs('the filled square', {kind: 'filled', color: '#3366cc'});
});

await step('a running entry on an archived project is named by the indicator and the button', async () => {
    // The service has read the project, which Projects does not list.
    mockSet('Running', new GLib.Variant('b', true));
    mockSet('ChosenProject', new GLib.Variant('x', 42));
    mockSet('ChosenProjectName', new GLib.Variant('s', 'Legacy'));
    mockSet('IndicatorColor', new GLib.Variant('s', '#2da608'));
    await indicatorIs('a named dot', {kind: 'filled', round: true, color: '#2da608', accessibleName: 'Legacy'});
    const name = shell(`${button}.accessible_name`);
    if (!name.includes('Legacy') || name.includes('Unavailable project'))
        throw new Error(`button name: ${name}`);
    const title = shell(`${button}._projectMenu.label.text`);
    if (title !== 'Project: Legacy (locked while running)')
        throw new Error(`title: ${title}`);
    mockSet('Running', new GLib.Variant('b', false));
    mockSet('ChosenProject', new GLib.Variant('x', 7));
    mockSet('ChosenProjectName', new GLib.Variant('s', 'Website'));
    mockSet('IndicatorColor', new GLib.Variant('s', '#3366cc'));
    await indicatorIs('the still square', {kind: 'filled', round: false, color: '#3366cc',
        accessibleName: 'Website (Acme)'});
});

await step('the ring keeps 3:1 against the top bar in light and dark styles', async () => {
    // The top bar is see-through in the overview, which GNOME Shell shows
    // at startup.
    shell('Main.overview.hide()');
    await waitFor('the session top bar', () => shell('Main.overview.visible') === false);
    const results = [];
    try {
        for (const scheme of ['default', 'prefer-light', 'prefer-dark']) {
            setInterface('set_string', 'color-scheme', scheme);
            await delay(500);
            const colours = shell(`(() => {
                const plain = color => ({red: color.red, green: color.green, blue: color.blue, alpha: color.alpha});
                return {
                    ring: plain(${button}._projectIndicator._edge.get_theme_node().get_foreground_color()),
                    bar: plain(Main.panel.get_theme_node().get_background_color()),
                };
            })()`);
            const ratio = contrastRatio(colours.ring, colours.bar);
            results.push(`${scheme}: ring ${JSON.stringify(colours.ring)} on ${JSON.stringify(colours.bar)} ` +
                `${ratio.toFixed(2)}:1`);
            if (colours.bar.alpha !== 255 || ratio < 3)
                throw new Error(results.join('; '));
        }
    } finally {
        setInterface('reset', 'color-scheme');
    }
    print(`# ${results.join('; ')}`);
});

await step('a change from the service sends nothing back', async () => {
    const before = mockCalls().length;
    const billable = shell(`${button}._billableItem.state`);
    mockSet('Billable', new GLib.Variant('b', !billable));
    await waitFor('the switch', () => shell(`${button}._billableItem.state`) === !billable);
    await delay(300);
    if (mockCalls().length !== before)
        throw new Error(`unexpected calls: ${JSON.stringify(mockCalls().slice(before))}`);
});

await step('a secondary click opens the menu and sends nothing', async () => {
    const before = mockCalls().length;
    click(3);
    await waitFor('the menu', () => menuOpen() === true);
    await delay(300);
    if (mockCalls().length !== before)
        throw new Error(`unexpected calls: ${JSON.stringify(mockCalls().slice(before))}`);
    shell(`${button}.menu.close()`);
});

await step('Space and Return do what a primary click does, and Down opens the menu', async () => {
    await pressFor('KEY_space', 'Start');
    await waitFor('Running', () => timerProperty('Running') === true);
    await pressFor('KEY_Return', 'Pause');
    await waitFor('Paused', () => timerProperty('Paused') === true);
    await pressFor('KEY_space', 'Resume');
    await waitFor('Running', () => timerProperty('Running') === true);
    const before = mockCalls().length;
    await waitFor('the menu from Down', () => {
        if (!menuOpen())
            press('KEY_Down');
        return menuOpen() === true;
    });
    if (mockCalls().length !== before)
        throw new Error(`Down sent ${JSON.stringify(mockCalls().slice(before))}`);
    if (toggleItem() !== 'Stop')
        throw new Error(`the menu offers ${toggleItem()}`);
    shell(`${button}._toggleItem.activate(null)`);
    await waitFor('Stop', () => lastCall()[0] === 'Stop' || mockCalls().slice(before));
    shell(`${button}.menu.close()`);
    await waitFor('0:00', () => label() === '0:00' || label());
});

await step('a status other than ready marks the time and disables writes', async () => {
    mockSet('ErrorString', new GLib.Variant('s', 'Network down'));
    mockSet('Status', new GLib.Variant('s', 'stale'));
    await waitFor('the mark', () => label() === '0:00!' || label());
    if (sensitive('_toggleItem') || sensitive('_projectMenu') || sensitive('_billableItem'))
        throw new Error('a write control stayed sensitive');
    const detail = shell(`${button}._detailItem.label.text`);
    if (detail !== 'Network down')
        throw new Error(`detail: ${detail}`);
    mockSet('Status', new GLib.Variant('s', 'ready'));
    await waitFor('no mark', () => label() === '0:00' || label());
});

await step('the button says so when the service goes away', async () => {
    call('org.tokkl.Timer1', '/org/tokkl/Timer1', 'org.tokkl.Timer1Mock', 'Quit', null, null);
    await waitFor('the mark', () => label() === '0:00!' || label());
    const status = shell(`${button}._statusItem.label.text`);
    if (status !== 'Timer service not running')
        throw new Error(`status: ${status}`);
    if (sensitive('_toggleItem'))
        throw new Error('Start stayed sensitive');
});

print(checks.failures ? `${checks.failures} failed` : 'all passed');
exit(checks.failures ? 1 : 0);
