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
 * @property {string} [alarmError] the AlarmError property: why the last
 *     alarm sound did not play; empty or missing when it played, or from a
 *     service older than the property
 * @property {Record<string, ActionState>|null} [actions] the Actions property,
 *     missing or null when the service publishes none
 * @property {string} [actionError] the extension's own word on a method call
 *     that failed, or the service's on a request it saw refused; empty or
 *     missing when there is none
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
    // the service may not have seen the call at all. A sound that did not
    // play comes last.
    const message = state.actionError || state.sessionMessage || state.alarmError || '';
    // A refused request's words are often ErrorString's too; they show once.
    const detailShown = words.detail.length > 0 && words.detail !== message;
    return {
        message: { text: message, visible: message.length > 0 },
        detail: { text: words.detail, visible: detailShown },
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

// How the button's time ends for each mark of the Presentation property.
const MARKS = { none: '', pending: '…', alert: '!', unconfigured: '!' };

/**
 * @typedef {object} Presentation the Presentation property: which parts
 *     the button's accessible name (summary) and the menu's status line
 *     (menuLine) show, in order, and how the button's time ends (mark)
 * @property {string[]} summary
 * @property {string[]} menuLine
 * @property {string} mark
 */

/**
 * The Presentation a service from before that property leaves the
 * extension to decide, by the rules the extension had: the core's
 * StatusPolicy::gnome(). Also the words with no service. A service that
 * publishes InterfaceVersion 1 or later publishes Presentation (publishes()
 * in timer1.js). Delete the older-service use when
 * OLDEST_SUPPORTED_INTERFACE_VERSION in timer1.js becomes 1; keep only what
 * the button shows with no service (status null). The accessible name
 * always names the project and the connection, its detail when there is
 * one, and outside a session the Pomodoro mode. The status line is the session's line during a session,
 * and otherwise the connection, after the paused total while paused.
 *
 * @param {{status: string|null, paused: boolean, pomodoroMode: boolean, session: object|null}} time
 *     status is the Status property, null when nothing owns the bus name
 * @param {{detail: string}} words describeStatus()
 * @returns {Presentation}
 */
export function legacyPresentation(time, words) {
    const detail = words.detail ? ['detail'] : [];
    const mark =
        { ready: 'none', loading: 'pending', busy: 'pending', unconfigured: 'unconfigured' }[time.status] ?? 'alert';
    if (time.session) return { summary: ['session', 'project', 'connection', ...detail], menuLine: ['session'], mark };
    return {
        summary: ['activity', 'project', 'connection', ...detail, ...(time.pomodoroMode ? ['pomodoroMode'] : [])],
        menuLine: time.paused ? ['activity', 'connection'] : ['connection'],
        mark,
    };
}

/**
 * The time on the button, the menu's status line and the button's
 * accessible name. During a session they show the phase's countdown instead
 * of the timer. Elapsed time is the chain total: what the chain's paused
 * entries stored plus the running entry's own time, frozen while paused.
 * Which parts the line and the name show, and how the time ends, is the
 * service's Presentation, or legacyPresentation() without it.
 *
 * @param {object} time
 * @param {string|null} time.status the Status property, null when nothing
 *     owns the bus name
 * @param {boolean} time.running
 * @param {boolean} time.paused
 * @param {number} time.startTime the LocalStartTime property: the start on
 *     this machine's clock
 * @param {number} time.chainSeconds the ChainSeconds property
 * @param {boolean} time.pomodoroMode
 * @param {{phase: string, plannedEnd: number, pomodoroNumber: number, longRestEvery: number}|null} time.session
 *     the session's properties while one is active
 * @param {Presentation|null} [time.presentation] the Presentation property
 * @param {{text: string, detail: string, mark: string}} words describeStatus()
 * @param {string} indicatorLabel the project indicator's accessible name
 * @param {number} nowSeconds the current Unix time in seconds
 * @param {(text: string) => string} _ gettext
 * @returns {{button: string, status: string, accessibleName: string}}
 */
export function describeTime(time, words, indicatorLabel, nowSeconds, _) {
    const presentation = time.presentation ?? legacyPresentation(time, words);
    let shown, activity;
    if (time.session) {
        shown = countdown(time.session.plannedEnd, nowSeconds).text;
        activity = '';
    } else {
        const running = time.running ? elapsedSeconds(time.startTime, nowSeconds) : 0;
        shown = formatElapsed(time.chainSeconds + running);
        activity = _('Stopped');
        // Translators: %s is the elapsed time as H:MM.
        if (time.running) activity = fill(_('Running %s'), shown);
        // Translators: %s is the paused total as H:MM.
        else if (time.paused) activity = fill(_('Paused %s'), shown);
    }
    const texts = {
        activity,
        session: time.session ? sessionLine(time.session, nowSeconds, _) : '',
        project: indicatorLabel,
        connection: words.text,
        detail: words.detail,
        pomodoroMode: _('Pomodoro mode'),
    };
    // The parts' words, those with any, joined by " · ".
    const render = parts =>
        parts
            .map(part => texts[part] ?? '')
            .filter(text => text)
            .join(' · ');
    return {
        button: `${shown}${MARKS[presentation.mark] ?? ''}`,
        status: render(presentation.menuLine),
        accessibleName: render(presentation.summary),
    };
}
