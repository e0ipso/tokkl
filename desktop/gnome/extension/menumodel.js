// What the panel button and its menu show for the service's state, with no
// GNOME Shell in it: indicator.js reads the properties, calls these and puts
// the result on screen.

import { legacyActions } from './legacyactions.js';
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
 * @typedef {object} ActionState one action of the Actions property
 * @property {boolean} visible
 * @property {boolean} enabled
 * @property {string} [label]
 */

/**
 * @typedef {object} ServiceState the org.tokkl.Timer1 properties the menu
 *     reads; status is null when nothing owns the bus name
 * @property {string|null} status
 * @property {Array<{id: number, name: string, clientName?: string}>} projects
 * @property {boolean} [projectsIncomplete]
 * @property {number} chosenProject
 * @property {string} chosenProjectName
 * @property {boolean} billable
 * @property {boolean} running
 * @property {boolean} paused
 * @property {boolean} pomodoroMode
 * @property {boolean} modeLocked
 * @property {boolean} sessionActive
 * @property {boolean} canStartSession
 * @property {string} upcomingPhase
 * @property {string} sessionMessage
 * @property {Record<string, ActionState>|null} [actions] the Actions property,
 *     missing or null when the service publishes none
 * @property {string} [actionError] the extension's own word on a method call
 *     that failed, empty or missing when none did
 */

/**
 * Each menu item's text, whether it shows and whether it can be chosen.
 *
 * Which items show and can be chosen is the service's to say: the Actions
 * property carries the shared core's rules, the ones the KDE and macOS
 * menus follow, with GNOME's policy (writes wait for Status "ready", and a
 * session leaves Project and Billable to the timer). This turns each
 * action's label into words. Start, or Stop while an entry runs or a chain
 * is paused, never pauses: Stop ends the chain. Without Actions, from no
 * service or one older than the property, legacyActions() gives the rules
 * that service's extension had.
 *
 * @param {ServiceState} state
 * @param {{detail: string}} words describeStatus() of the state
 * @param {(text: string) => string} _ gettext
 */
export function describeMenu(state, words, _) {
    const actions = state.status !== null && state.actions ? state.actions : legacyActions(state);
    const chosen = chosenProjectLabel(state.projects, state.chosenProject, state.chosenProjectName, _);
    // Translators: %s is the project's name, or No project.
    let projectText = fill(_('Project: %s'), chosen);
    // Translators: %s is the project's name, or No project.
    if (actions.project.label === 'projectRunning') projectText = fill(_('Project: %s (locked while running)'), chosen);
    // Translators: %s is the project's name, or No project.
    else if (actions.project.label === 'projectPaused')
        projectText = fill(_('Project: %s (locked while paused)'), chosen);
    // A call that failed outranks the service's message: it is newer, and
    // the service may not have seen the call at all.
    const message = state.actionError || state.sessionMessage;
    return {
        message: { text: message, visible: message.length > 0 },
        detail: { text: words.detail, visible: words.detail.length > 0 },
        toggle: {
            text: actions.run.label === 'stop' ? _('Stop') : _('Start'),
            sensitive: actions.run.enabled,
            visible: actions.run.visible,
        },
        startSession: { visible: actions.startSession.visible, sensitive: actions.startSession.enabled },
        nextPhase: {
            text: nextPhaseLabel(actions.nextPhase.label, _),
            visible: actions.nextPhase.visible,
            sensitive: actions.nextPhase.enabled,
        },
        endSession: { visible: actions.endSession.visible, sensitive: actions.endSession.enabled },
        mode: {
            text: pomodoroModeLabel(actions.mode.label === 'pomodoroModeLocked', _),
            checked: state.pomodoroMode,
            sensitive: actions.mode.enabled,
        },
        project: { text: projectText, sensitive: actions.project.enabled },
        billable: { checked: state.billable, sensitive: actions.billable.enabled },
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
