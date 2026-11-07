// The menu's action rules for a tokkl-timerd older than the release that
// added the Actions property. The extension updates from
// extensions.gnome.org while the service comes from a package, so a new
// extension often talks to an older service; this keeps its menu as that
// service's extension showed it. A current service publishes Actions, from
// the shared core's rules, and these are not used. Remove this module once
// services without Actions are no longer supported.

/**
 * The Actions an older service would have meant, from the properties it
 * publishes, in the shape of the Actions property. status is null when
 * nothing owns the bus name.
 *
 * Start, or Stop while an entry runs or a chain is paused, shows without a
 * session in Timer mode, and in Pomodoro mode while a timer runs or is
 * paused, and can be chosen while the service is ready. Start session shows
 * in Pomodoro mode while no session is active and no timer runs or is
 * paused, and follows CanStartSession. Next phase and End session show
 * while a session is active. Project is locked while an entry runs or a
 * chain is paused, Billable while paused, and both wait for ready. Pomodoro
 * mode is locked while ModeLocked or without a service.
 *
 * @param {{status: string|null, running: boolean, paused: boolean, pomodoroMode: boolean,
 *     modeLocked: boolean, sessionActive: boolean, canStartSession: boolean, upcomingPhase: string}} state
 * @returns {Record<string, {visible: boolean, enabled: boolean, label: string}>}
 */
export function legacyActions(state) {
    const ready = state.status === 'ready';
    const timerHeld = state.running || state.paused;
    let project = 'project';
    if (state.running) project = 'projectRunning';
    else if (state.paused) project = 'projectPaused';
    return {
        run: {
            visible: !state.sessionActive && (!state.pomodoroMode || timerHeld),
            enabled: ready,
            label: timerHeld ? 'stop' : 'start',
        },
        startSession: {
            visible: state.pomodoroMode && !state.sessionActive && !timerHeld,
            enabled: state.canStartSession,
            label: 'startSession',
        },
        // The menu never made these insensitive.
        nextPhase: { visible: state.sessionActive, enabled: true, label: state.upcomingPhase },
        endSession: { visible: state.sessionActive, enabled: true, label: 'endSession' },
        project: { visible: true, enabled: ready && !timerHeld, label: project },
        billable: { visible: true, enabled: ready && !state.paused, label: 'billable' },
        mode: {
            visible: true,
            enabled: state.status !== null && !state.modeLocked,
            label: state.modeLocked ? 'pomodoroModeLocked' : 'pomodoroMode',
        },
    };
}
