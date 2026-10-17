// A stand-in for tokkl-timerd in the extension check: it owns
// org.tokkl.Timer1 on the session bus with the interface description from
// desktop/gnome/dbus, keeps a timer in memory with no server behind it, and
// records every method call. A second interface, org.tokkl.Timer1Mock,
// lets the check read the calls, change properties and stop the mock.
//
//   gjs -m mock-timer.js /path/to/org.tokkl.Timer1.xml

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {programArgs} from 'system';

const [interfacePath] = programArgs;
const [, bytes] = GLib.file_get_contents(interfacePath);
const timerXml = new TextDecoder().decode(bytes);

const mockXml = `<node>
  <interface name="org.tokkl.Timer1Mock">
    <method name="Calls"><arg name="json" type="s" direction="out"/></method>
    <method name="Quit"/>
    <method name="Set">
      <arg name="name" type="s" direction="in"/>
      <arg name="value" type="v" direction="in"/>
    </method>
  </interface>
</node>`;

const types = {
    Running: 'b', StartTime: 'x', IndicatorState: 's', IndicatorColor: 's', Projects: 'aa{sv}',
    ChosenProject: 'x', Billable: 'b', Status: 's', ErrorString: 's',
};

const state = {
    Running: false,
    StartTime: 0,
    IndicatorState: 'none',
    IndicatorColor: '',
    Projects: [
        {id: 7, name: 'Website', clientName: 'Acme', color: '#3366cc', billable: true},
        {id: 9, name: 'Internal', clientName: '', color: '#cc6633', billable: false},
    ],
    ChosenProject: 0,
    Billable: false,
    Status: 'ready',
    ErrorString: '',
};

const calls = [];
let timer = null;

function variant(name) {
    if (name === 'Projects') {
        return new GLib.Variant('aa{sv}', state.Projects.map(project => ({
            id: new GLib.Variant('x', project.id),
            name: new GLib.Variant('s', project.name),
            clientName: new GLib.Variant('s', project.clientName),
            color: new GLib.Variant('s', project.color),
            billable: new GLib.Variant('b', project.billable),
        })));
    }
    return new GLib.Variant(types[name], state[name]);
}

function set(values) {
    for (const [name, value] of Object.entries(values)) {
        if (state[name] === value)
            continue;
        state[name] = value;
        timer.emit_property_changed(name, variant(name));
    }
}

class Timer1 {
    Start() {
        calls.push(['Start']);
        if (state.Running || state.Status !== 'ready')
            return false;
        set({Running: true, StartTime: Math.floor(Date.now() / 1000)});
        return true;
    }

    Stop() {
        calls.push(['Stop']);
        if (!state.Running || state.Status !== 'ready')
            return false;
        set({Running: false, StartTime: 0});
        return true;
    }

    SetProject(projectId) {
        calls.push(['SetProject', projectId]);
        if (state.Running || (projectId !== 0 && !state.Projects.some(p => p.id === projectId)))
            return false;
        const project = state.Projects.find(p => p.id === projectId);
        set({
            ChosenProject: projectId,
            Billable: project ? project.billable : false,
            IndicatorState: project ? 'project' : 'none',
            IndicatorColor: project ? project.color : '',
        });
        return true;
    }

    SetBillable(billable) {
        calls.push(['SetBillable', billable]);
        set({Billable: billable});
        return true;
    }

    Configure(instanceUrl, authMode, email, secret) {
        calls.push(['Configure', instanceUrl, authMode, email, secret]);
        if (!instanceUrl.startsWith('https://'))
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS, 'Enter an https:// URL.');
    }
}

const implementation = new Timer1();
for (const name of Object.keys(types))
    Object.defineProperty(implementation, name, {get: () => variant(name).deepUnpack()});
timer = Gio.DBusExportedObject.wrapJSObject(timerXml, implementation);

const loop = new GLib.MainLoop(null, false);

const mock = Gio.DBusExportedObject.wrapJSObject(mockXml, {
    Calls: () => JSON.stringify(calls),
    Set: (name, value) => set({[name]: value.recursiveUnpack()}),
    Quit: () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => loop.quit()),
});

Gio.bus_own_name(Gio.BusType.SESSION, 'org.tokkl.Timer1', Gio.BusNameOwnerFlags.NONE,
    connection => {
        timer.export(connection, '/org/tokkl/Timer1');
        mock.export(connection, '/org/tokkl/Timer1');
    },
    null,
    () => {
        printerr('mock-timer: cannot own org.tokkl.Timer1');
        loop.quit();
    });
loop.run();
