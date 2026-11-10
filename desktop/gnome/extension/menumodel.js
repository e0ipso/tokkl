// Panel and menu text for the service's state, with no GNOME Shell imports.

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

// Without a usable service, Start and the switches show and nothing can be chosen.
const OFFLINE_ACTIONS = {
    run: { visible: true, enabled: false, label: 'start' },
    startSession: { visible: false, enabled: false, label: 'startSession' },
    nextPhase: { visible: false, enabled: false, label: '' },
    endSession: { visible: false, enabled: false, label: 'endSession' },
    project: { visible: true, enabled: false, label: 'project' },
    billable: { visible: true, enabled: false, label: 'billable' },
    mode: { visible: true, enabled: false, label: 'pomodoroMode' },
};

// The Actions property carries the core's rules plus GNOME's policy that
// writes wait for Status "ready". This only turns each label into words.
export function describeMenu(state, words, _) {
    const actions = state.status !== null && state.actions ? state.actions : OFFLINE_ACTIONS;
    const chosen = chosenProjectLabel(state.chosenProjectLabel, _);
    // Translators: %s is the project's name, or No project.
    let projectText = fill(_('Project: %s'), chosen);
    // Translators: %s is the project's name, or No project.
    if (actions.project.label === 'projectRunning') projectText = fill(_('Project: %s (locked while running)'), chosen);
    // Translators: %s is the project's name, or No project.
    else if (actions.project.label === 'projectPaused')
        projectText = fill(_('Project: %s (locked while paused)'), chosen);
    // A failed call outranks the service's message: it is newer, and the service
    // may never have seen it. A sound that did not play comes last.
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

// The cut-short note goes before the projects, as in the KDE and macOS menus,
// so a long list does not bury it.
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

// Keyed as statusMarkKeys() in desktop/core/src/statuspresentation.h.
export const MARKS = { none: '', pending: '…', alert: '!', unconfigured: '!' };

function offlinePresentation(words) {
    return {
        summary: ['activity', 'project', 'connection', ...(words.detail ? ['detail'] : [])],
        menuLine: ['connection'],
        mark: 'alert',
    };
}

function shownTime(time, nowSeconds) {
    if (time.session) return countdown(time.session.plannedEnd, nowSeconds).text;
    const running = time.running ? elapsedSeconds(time.startTime, nowSeconds) : 0;
    return formatElapsed(time.chainSeconds + running);
}

// Keyed as statusPartKeys() in desktop/core/src/statuspresentation.h. The
// session message has its own menu item, so its part stays empty here.
export function partTexts(time, words, indicatorLabel, nowSeconds, _) {
    let activity = '';
    if (!time.session) {
        const shown = shownTime(time, nowSeconds);
        activity = _('Stopped');
        // Translators: %s is the elapsed time as H:MM.
        if (time.running) activity = fill(_('Running %s'), shown);
        // Translators: %s is the paused total as H:MM.
        else if (time.paused) activity = fill(_('Paused %s'), shown);
    }
    return {
        activity,
        session: time.session ? sessionLine(time.session, nowSeconds, _) : '',
        project: indicatorLabel,
        connection: words.text,
        detail: words.detail,
        pomodoroMode: _('Pomodoro mode'),
        message: '',
    };
}

// Elapsed time is the chain total, frozen while paused. During a session the
// phase countdown replaces it.
export function describeTime(time, words, indicatorLabel, nowSeconds, _) {
    const presentation = time.presentation ?? offlinePresentation(words);
    const texts = partTexts(time, words, indicatorLabel, nowSeconds, _);
    const render = parts =>
        parts
            .map(part => texts[part] ?? '')
            .filter(text => text)
            .join(' · ');
    return {
        button: `${shownTime(time, nowSeconds)}${MARKS[presentation.mark] ?? ''}`,
        status: render(presentation.menuLine),
        accessibleName: render(presentation.summary),
    };
}
