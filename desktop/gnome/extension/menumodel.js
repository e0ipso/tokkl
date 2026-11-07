// What the panel button and its menu show for the service's state, with no
// GNOME Shell in it: indicator.js reads the properties, calls these and puts
// the result on screen.

import {
    chosenProjectLabel,
    countdown,
    elapsedSeconds,
    fill,
    formatElapsed,
    nextPhaseLabel,
    pomodoroModeLabel,
    sessionLine,
} from './timer1.js';

/**
 * @typedef {object} ServiceState the org.tokkl.Timer1 properties the menu
 *     reads; status is null when nothing owns the bus name
 * @property {string|null} status
 * @property {boolean} running
 * @property {boolean} paused
 * @property {Array<{id: number, name: string, clientName?: string}>} projects
 * @property {boolean} [projectsIncomplete]
 * @property {number} chosenProject
 * @property {string} chosenProjectName
 * @property {boolean} billable
 * @property {boolean} pomodoroMode
 * @property {boolean} modeLocked
 * @property {boolean} sessionActive
 * @property {boolean} canStartSession
 * @property {string} upcomingPhase
 * @property {string} sessionMessage
 * @property {string} [actionError] the extension's own word on a method call
 *     that failed, empty or missing when none did
 */

/**
 * Each menu item's text, whether it shows and whether it can be chosen.
 *
 * Start, or Stop while an entry runs or a chain is paused, never pauses:
 * Stop ends the chain. Pomodoro mode hides it unless a timer runs or is
 * paused, since the service starts no timer then, and an active session
 * hides it in either mode. The session's items follow the published state;
 * the service refuses what does not apply. Project chooses the project of
 * the next start and is locked while an entry runs or a chain is paused.
 * Billable stays editable while an entry runs, as the service then edits
 * that entry, and shows the paused entry's flag, which cannot change, while
 * paused.
 *
 * @param {ServiceState} state
 * @param {{detail: string}} words describeStatus() of the state
 * @param {(text: string) => string} _ gettext
 */
export function describeMenu(state, words, _) {
    const ready = state.status === 'ready';
    const timerHeld = state.running || state.paused;
    const chosen = chosenProjectLabel(state.projects, state.chosenProject, state.chosenProjectName, _);
    // Translators: %s is the project's name, or No project.
    let projectText = fill(_('Project: %s'), chosen);
    // Translators: %s is the project's name, or No project.
    if (state.running) projectText = fill(_('Project: %s (locked while running)'), chosen);
    // Translators: %s is the project's name, or No project.
    else if (state.paused) projectText = fill(_('Project: %s (locked while paused)'), chosen);
    // A call that failed outranks the service's message: it is newer, and
    // the service may not have seen the call at all.
    const message = state.actionError || state.sessionMessage;
    return {
        message: { text: message, visible: message.length > 0 },
        detail: { text: words.detail, visible: words.detail.length > 0 },
        toggle: {
            text: timerHeld ? _('Stop') : _('Start'),
            sensitive: ready,
            visible: !state.sessionActive && (!state.pomodoroMode || timerHeld),
        },
        // The service says when a session can start: not before it has read
        // the server's state, and not while an action waits for its answer.
        startSession: {
            visible: state.pomodoroMode && !state.sessionActive && !timerHeld,
            sensitive: state.canStartSession,
        },
        nextPhase: { text: nextPhaseLabel(state.upcomingPhase, _), visible: state.sessionActive },
        endSession: { visible: state.sessionActive },
        mode: {
            text: pomodoroModeLabel(state.modeLocked, _),
            checked: state.pomodoroMode,
            sensitive: state.status !== null && !state.modeLocked,
        },
        project: { text: projectText, sensitive: ready && !state.running && !state.paused },
        billable: { checked: state.billable, sensitive: ready && !state.paused },
    };
}

/**
 * The project submenu: No project, then one item per project, the chosen
 * one checked. When ProjectsIncomplete says the list is cut short, a note
 * that cannot be chosen comes before the projects, as in the KDE and macOS
 * menus, so a long list does not bury it.
 *
 * @param {Array<{id: number, name: string, clientName?: string}>} projects
 * @param {number} chosenProject
 * @param {(project: {name: string, clientName?: string}) => string} label
 * @param {(text: string) => string} _ gettext
 * @param {boolean} [incomplete] the ProjectsIncomplete property
 * @returns {Array<{id: number, label: string, checked: boolean, note?: boolean}>}
 */
export function projectChoices(projects, chosenProject, label, _, incomplete = false) {
    const choices = [{ id: 0, label: _('No project'), checked: chosenProject === 0 }];
    if (incomplete) {
        choices.push({
            id: null,
            label: _('Project list cut short. Open Tokkl in a browser for the others.'),
            checked: false,
            note: true,
        });
    }
    for (const project of projects) {
        choices.push({ id: project.id, label: label(project), checked: project.id === chosenProject });
    }
    return choices;
}

/**
 * The time on the button, the menu's status line and the button's
 * accessible name. During a session they show the phase's countdown instead
 * of the timer. Elapsed time is the chain total: what the chain's paused
 * entries stored plus the running entry's own time, frozen while paused.
 *
 * @param {object} time
 * @param {boolean} time.running
 * @param {boolean} time.paused
 * @param {number} time.startTime the LocalStartTime property: the start on
 *     this machine's clock
 * @param {number} time.chainSeconds the ChainSeconds property
 * @param {boolean} time.pomodoroMode
 * @param {{phase: string, plannedEnd: number, pomodoroNumber: number, longRestEvery: number}|null} time.session
 *     the session's properties while one is active
 * @param {{text: string, detail: string, mark: string}} words describeStatus()
 * @param {string} indicatorLabel the project indicator's accessible name
 * @param {number} nowSeconds the current Unix time in seconds
 * @param {(text: string) => string} _ gettext
 * @returns {{button: string, status: string, accessibleName: string}}
 */
export function describeTime(time, words, indicatorLabel, nowSeconds, _) {
    let button, timer, status;
    if (time.session) {
        button = `${countdown(time.session.plannedEnd, nowSeconds).text}${words.mark}`;
        timer = status = sessionLine(time.session, nowSeconds, _);
    } else {
        const running = time.running ? elapsedSeconds(time.startTime, nowSeconds) : 0;
        const elapsed = formatElapsed(time.chainSeconds + running);
        button = `${elapsed}${words.mark}`;
        timer = _('Stopped');
        status = words.text;
        if (time.running) {
            // Translators: %s is the elapsed time as H:MM.
            timer = fill(_('Running %s'), elapsed);
        } else if (time.paused) {
            // Translators: %s is the paused total as H:MM.
            timer = fill(_('Paused %s'), elapsed);
            // While paused the line leads with the chain total, then the
            // connection state, as the KDE and macOS menus do.
            // Translators: %1$s is the paused total as H:MM, %2$s the
            // connection state, such as Connected.
            status = fill(_('Paused %1$s · %2$s'), elapsed, words.text);
        }
    }

    const parts = [timer];
    if (indicatorLabel) parts.push(indicatorLabel);
    parts.push(words.text);
    if (words.detail) parts.push(words.detail);
    if (time.pomodoroMode && !time.session) parts.push(_('Pomodoro mode'));
    return { button, status, accessibleName: parts.join(' · ') };
}
