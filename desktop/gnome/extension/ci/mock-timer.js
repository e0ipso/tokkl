// A stand-in for tokkl-timerd in the extension check: it owns
// org.tokkl.Timer1 on the session bus with the interface description from
// desktop/gnome/dbus, keeps a timer in memory with no server behind it, and
// records every method call. A second interface, org.tokkl.Timer1Mock,
// lets the check read the calls, change properties, start a session as
// another device would, and stop the mock.
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
    <method name="StartForeignSession"/>
    <method name="Set">
      <arg name="name" type="s" direction="in"/>
      <arg name="value" type="v" direction="in"/>
    </method>
  </interface>
</node>`;

const types = {
    Running: 'b', StartTime: 'x', Paused: 'b', ChainSeconds: 'x', IndicatorState: 's', IndicatorColor: 's', Projects: 'aa{sv}',
    ChosenProject: 'x', ChosenProjectName: 's', Billable: 'b', Status: 's', ErrorString: 's',
    PomodoroLengths: 'a{si}', PomodoroLengthsEditable: 'b', PomodoroLengthErrors: 'a{ss}', Sounds: 'a{ss}',
    SoundChoices: 'aa{sv}',
    PomodoroMode: 'b', ModeLocked: 'b', SessionActive: 'b', Phase: 's', PhaseStart: 'x', PlannedEnd: 'x',
    PomodoroNumber: 'i', LongRestEvery: 'i', UpcomingPhase: 's', Ringing: 'b', RingingTransition: 's', SessionMessage: 's',
    CanStartSession: 'b',
};

const state = {
    Running: false,
    StartTime: 0,
    Paused: false,
    ChainSeconds: 0,
    IndicatorState: 'none',
    IndicatorColor: '',
    Projects: [
        {id: 7, name: 'Website', clientName: 'Acme', color: '#3366cc', billable: true},
        {id: 9, name: 'Internal', clientName: '', color: '#cc6633', billable: false},
    ],
    ChosenProject: 0,
    ChosenProjectName: '',
    Billable: false,
    Status: 'ready',
    ErrorString: '',
    PomodoroLengths: {work: 25, shortRest: 5, longRest: 15, longRestEvery: 4},
    PomodoroLengthsEditable: true,
    PomodoroLengthErrors: {},
    Sounds: {
        workToShortRest: 'work-to-short-rest',
        shortRestToWork: 'short-rest-to-work',
        workToLongRest: 'work-to-long-rest',
        longRestToWork: 'long-rest-to-work',
    },
    SoundChoices: [
        {id: 'work-to-short-rest', label: 'Two falling notes'},
        {id: 'short-rest-to-work', label: 'Three rising notes'},
        {id: 'work-to-long-rest', label: 'Four slow falling notes'},
        {id: 'long-rest-to-work', label: 'Fast high run'},
    ],
    PomodoroMode: false,
    ModeLocked: false,
    SessionActive: false,
    CanStartSession: false,
    Phase: '',
    PhaseStart: 0,
    PlannedEnd: 0,
    PomodoroNumber: 0,
    LongRestEvery: 0,
    UpcomingPhase: '',
    Ringing: false,
    RingingTransition: '',
    SessionMessage: '',
};

// The lengths on the Tokkl server behind the service. RefreshPreferences
// reads them into PomodoroLengths, which starts with the defaults.
const accountLengths = {work: 50, shortRest: 10, longRest: 20, longRestEvery: 3};

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
    if (name === 'SoundChoices') {
        return new GLib.Variant('aa{sv}', state.SoundChoices.map(choice => ({
            id: new GLib.Variant('s', choice.id),
            label: new GLib.Variant('s', choice.label),
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
    // As the service does: the mode cannot change while an entry runs, a
    // chain is paused or a session is active, and a session can start in
    // Pomodoro mode when nothing runs and the account is ready.
    const derived = {};
    const locked = state.Running || state.Paused || state.SessionActive;
    if (state.ModeLocked !== locked)
        derived.ModeLocked = locked;
    const canStart = state.PomodoroMode && !locked && state.Status === 'ready';
    if (state.CanStartSession !== canStart)
        derived.CanStartSession = canStart;
    if (Object.keys(derived).length > 0)
        set(derived);
}

const now = () => Math.floor(Date.now() / 1000);

// Starts a phase of the session now with the account's lengths, and names
// the phase after it: a long rest after every LongRestEvery work phases,
// otherwise a short rest, and work after every rest.
function startPhase(kind, pomodoroNumber) {
    const start = now();
    let next = 'work';
    if (kind === 'work')
        next = pomodoroNumber % state.LongRestEvery === 0 ? 'longRest' : 'shortRest';
    set({
        Phase: kind,
        PhaseStart: start,
        PlannedEnd: start + state.PomodoroLengths[kind] * 60,
        PomodoroNumber: pomodoroNumber,
        UpcomingPhase: next,
        Ringing: false,
        RingingTransition: '',
    });
}

// As the service does: a pause stores the stopped entry's seconds in the
// chain, a resume starts its clone, and Stop ends the chain. The timer does
// nothing while a session is active, whichever device started it.
class Timer1 {
    Start() {
        calls.push(['Start']);
        if (state.Running || state.Paused || state.SessionActive || state.Status !== 'ready' || state.PomodoroMode)
            return false;
        set({Running: true, StartTime: now()});
        return true;
    }

    Stop() {
        calls.push(['Stop']);
        if (state.SessionActive)
            return false;
        if (state.Paused) {
            set({Paused: false, ChainSeconds: 0});
            return true;
        }
        if (!state.Running || state.Status !== 'ready')
            return false;
        set({Running: false, StartTime: 0, ChainSeconds: 0});
        return true;
    }

    Pause() {
        calls.push(['Pause']);
        if (state.SessionActive || !state.Running || state.Status !== 'ready')
            return false;
        set({
            Running: false,
            Paused: true,
            ChainSeconds: state.ChainSeconds + Math.max(0, now() - state.StartTime),
            StartTime: 0,
        });
        return true;
    }

    Resume() {
        calls.push(['Resume']);
        if (state.SessionActive || !state.Paused || state.Status !== 'ready')
            return false;
        set({Paused: false, Running: true, StartTime: now()});
        return true;
    }

    SetProject(projectId) {
        calls.push(['SetProject', projectId]);
        if (state.Running || state.Paused || (projectId !== 0 && !state.Projects.some(p => p.id === projectId)))
            return false;
        const project = state.Projects.find(p => p.id === projectId);
        set({
            ChosenProject: projectId,
            ChosenProjectName: project ? project.name : '',
            Billable: project ? project.billable : false,
            IndicatorState: project ? 'project' : 'none',
            IndicatorColor: project ? project.color : '',
        });
        return true;
    }

    SetBillable(billable) {
        calls.push(['SetBillable', billable]);
        if (state.Paused)
            return false;
        set({Billable: billable});
        return true;
    }

    Configure(instanceUrl, authMode, email, secret) {
        calls.push(['Configure', instanceUrl, authMode, email, secret]);
        if (!instanceUrl.startsWith('https://'))
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS, 'Enter an https:// URL.');
    }

    SetPomodoroMode(pomodoro) {
        calls.push(['SetPomodoroMode', pomodoro]);
        if (state.ModeLocked)
            return false;
        set({PomodoroMode: pomodoro});
        return true;
    }

    // The panel's left-click, decided as the service decides it. The mock
    // has no clock, so the check sets Ringing itself. Only Activate is
    // recorded: the methods it runs are the service's own doing.
    Activate() {
        const before = calls.length;
        let action = 'handled';
        if (state.SessionActive) {
            if (state.Ringing)
                this.NextPhase();
            else
                action = 'open-menu';
        } else if (state.Running || state.Paused || !state.PomodoroMode) {
            if (state.Paused)
                this.Resume();
            else if (state.Running)
                this.Pause();
            else
                this.Start();
        } else {
            action = this.StartSession() ? 'handled' : 'ignored';
        }
        calls.splice(before, calls.length - before, ['Activate']);
        return action;
    }

    // The phase details come first, so a session is never active without
    // them.
    StartSession() {
        calls.push(['StartSession']);
        if (!state.CanStartSession)
            return false;
        set({SessionMessage: '', LongRestEvery: state.PomodoroLengths.longRestEvery});
        startPhase('work', 1);
        set({SessionActive: true});
        return true;
    }

    NextPhase() {
        calls.push(['NextPhase']);
        if (!state.SessionActive)
            return false;
        if (state.Phase === 'work')
            startPhase(state.UpcomingPhase, state.PomodoroNumber);
        else
            startPhase('work', state.Phase === 'longRest' ? 1 : state.PomodoroNumber + 1);
        return true;
    }

    EndSession() {
        calls.push(['EndSession']);
        if (!state.SessionActive)
            return false;
        set({
            SessionActive: false, Phase: '', PhaseStart: 0, PlannedEnd: 0, PomodoroNumber: 0, LongRestEvery: 0,
            UpcomingPhase: '', Ringing: false, RingingTransition: '',
        });
        return true;
    }

    // As the service does: a save clears the errors, sends nothing when no
    // length differs, and the server keeps what it accepts.
    SetPomodoroLengths(work, shortRest, longRest, longRestEvery) {
        calls.push(['SetPomodoroLengths', work, shortRest, longRest, longRestEvery]);
        if (!state.PomodoroLengthsEditable)
            return false;
        if (Object.keys(state.PomodoroLengthErrors).length > 0)
            set({PomodoroLengthErrors: {}});
        const lengths = {work, shortRest, longRest, longRestEvery};
        if (Object.entries(lengths).every(([key, value]) => state.PomodoroLengths[key] === value))
            return false;
        Object.assign(accountLengths, lengths);
        set({PomodoroLengths: lengths});
        return true;
    }

    RefreshPreferences() {
        calls.push(['RefreshPreferences']);
        set({PomodoroLengths: {...accountLengths}});
    }

    SetSound(transition, soundId) {
        calls.push(['SetSound', transition, soundId]);
        if (!(transition in state.Sounds) || !state.SoundChoices.some(choice => choice.id === soundId))
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS, 'Unknown transition or sound.');
        set({Sounds: {...state.Sounds, [transition]: soundId}});
        return true;
    }

    PreviewSound(soundId) {
        calls.push(['PreviewSound', soundId]);
        if (!state.SoundChoices.some(choice => choice.id === soundId))
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS, 'Unknown sound.');
        return true;
    }
}

const implementation = new Timer1();
for (const name of Object.keys(types))
    Object.defineProperty(implementation, name, {get: () => variant(name).deepUnpack()});
timer = Gio.DBusExportedObject.wrapJSObject(timerXml, implementation);

const loop = new GLib.MainLoop(null, false);

const mock = Gio.DBusExportedObject.wrapJSObject(mockXml, {
    Calls: () => JSON.stringify(calls),
    // A session another device started: no call of this device's is
    // recorded, and the mode stays as it is.
    StartForeignSession: () => {
        set({SessionMessage: '', LongRestEvery: state.PomodoroLengths.longRestEvery});
        startPhase('work', 1);
        set({SessionActive: true});
    },
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
