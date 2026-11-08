// The org.tokkl.Timer1 contract as the extension and its preferences see it,
// and the words and numbers they show for it. Nothing here imports from GNOME
// Shell or GTK, so Node runs its tests.
//
// tokkl-timerd owns every rule of the timer. These helpers only turn the
// properties it publishes into text.

export const BUS_NAME = 'org.tokkl.Timer1';
export const OBJECT_PATH = '/org/tokkl/Timer1';

// The interface description the extension reads at run time, next to its
// modules. pack-extension.sh copies it from desktop/gnome/dbus, the one
// source of the contract: tokkl-timerd installs that file and its tests
// compare it with the service's introspection, and the extension's tests and
// the Shell harness's mock read it there.
export const TIMER1_XML_FILE = 'org.tokkl.Timer1.xml';

// The values of Configure's authMode argument.
export const AUTH_MODES = ['token', 'password'];

// The oldest tokkl-timerd the extension supports, by the InterfaceVersion it
// publishes. Version 1 publishes Actions, Presentation, PomodoroLengthLimits
// and the Request methods, and version 2 ChosenProjectLabel; the extension
// relies on all of them. A
// service below it, or one without InterfaceVersion (tokkl-timerd 2.1.0 and
// older), gets no menu of its own: the menu says to update tokkl-timerd
// (describeStatus()) and sends it nothing. desktop/gnome/README.md states the
// same floor.
export const OLDEST_SUPPORTED_INTERFACE_VERSION = 2;

/**
 * Whether the extension can use a service with this InterfaceVersion.
 *
 * @param {number} interfaceVersion the InterfaceVersion property, 0 for a
 *     service without it
 * @returns {boolean}
 */
export function supportsService(interfaceVersion) {
    return interfaceVersion >= OLDEST_SUPPORTED_INTERFACE_VERSION;
}

/**
 * Seconds since startTime, never negative. startTime is the LocalStartTime
 * property, the start on this machine's clock: Unix seconds, or 0 when no
 * entry runs.
 *
 * @param {number} startTime
 * @param {number} nowSeconds the current Unix time in seconds
 * @returns {number}
 */
export function elapsedSeconds(startTime, nowSeconds) {
    if (!(startTime > 0)) return 0;
    return Math.max(0, Math.floor(nowSeconds) - startTime);
}

/**
 * H:MM in whole minutes, as the other Tokkl desktop apps write elapsed time.
 * The seconds are dropped, not rounded.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

// M:SS with the minutes unwrapped, so three hours are 180:00.
function minutesAndSeconds(seconds) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Fills the placeholders of a translated template. %1$s or %2$d takes the
 * value at that position, from 1, so a translation can put the values in
 * another order; a plain %s or %d takes the next value in order. The
 * extension and its preferences use it rather than String.prototype.format,
 * which exists only inside GNOME Shell and has no positions.
 *
 * @param {string} template
 * @param {...any} values
 * @returns {string}
 */
export function fill(template, ...values) {
    let next = 0;
    return template.replace(/%(?:([1-9][0-9]*)\$)?[sd]/g, (_match, position) =>
        String(position ? values[Number(position) - 1] : values[next++]),
    );
}

/**
 * The phase's countdown as the panel shows it, from the PlannedEnd property
 * (Unix seconds): M:SS left, rounded up, before the planned end, and +M:SS
 * overtime, rounded down, from the planned end on. It is display only: the
 * service decides when a phase rings.
 *
 * @param {number} plannedEnd
 * @param {number} nowSeconds the current Unix time in seconds
 * @returns {{text: string, overtime: boolean}}
 */
export function countdown(plannedEnd, nowSeconds) {
    const ms = Math.round((plannedEnd - nowSeconds) * 1000);
    if (ms > 0) return { text: minutesAndSeconds(Math.ceil(ms / 1000)), overtime: false };
    return { text: `+${minutesAndSeconds(Math.floor(-ms / 1000))}`, overtime: true };
}

/**
 * Work, Short rest or Long rest for the Phase or UpcomingPhase property;
 * empty for anything else.
 *
 * @param {string} phase
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function phaseName(phase, _) {
    switch (phase) {
        case 'work':
            return _('Work');
        case 'shortRest':
            return _('Short rest');
        case 'longRest':
            return _('Long rest');
        default:
            return '';
    }
}

/**
 * The session in one line, as the KDE and macOS apps write it: "Short rest ·
 * 4:10 left · Pomodoro 2 of 4", or "Work · +1:02 overtime · Pomodoro 3 of 4".
 *
 * @param {{phase: string, plannedEnd: number, pomodoroNumber: number, longRestEvery: number}} session
 *     the Phase, PlannedEnd, PomodoroNumber and LongRestEvery properties
 * @param {number} nowSeconds the current Unix time in seconds
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function sessionLine(session, nowSeconds, _) {
    const { text, overtime } = countdown(session.plannedEnd, nowSeconds);
    // Translators: %s is the countdown, such as 1:02.
    const time = fill(overtime ? _('%s overtime') : _('%s left'), text);
    return fill(
        // Translators: %1$s is the phase (Work, Short rest or Long rest), %2$s
        // the time left or over, such as "4:10 left", %3$d the pomodoro's
        // place in the round and %4$d the pomodoros per round.
        _('%1$s · %2$s · Pomodoro %3$d of %4$d'),
        phaseName(session.phase, _),
        time,
        session.pomodoroNumber,
        session.longRestEvery,
    );
}

/**
 * The menu item that calls NextPhase, named after the UpcomingPhase
 * property.
 *
 * @param {string} upcomingPhase
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function nextPhaseLabel(upcomingPhase, _) {
    // Translators: %s is the phase NextPhase starts: Work, Short rest or Long rest.
    return fill(_('Next phase: %s'), phaseName(upcomingPhase, _));
}

/**
 * The menu switch that calls SetPomodoroMode; it says so while ModeLocked.
 *
 * @param {boolean} locked
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function pomodoroModeLabel(locked, _) {
    return locked ? _('Pomodoro mode (locked while running)') : _('Pomodoro mode');
}

/**
 * The words for a value of the Status property, keyed as the core keys the
 * timer's status (timerStatusKeys() in desktop/core/src/statuspresentation.h);
 * undefined for any other value. detail is empty or a longer explanation;
 * mark says how the panel time ends: '' when ready, '…' while loading or
 * saving, '!' when the timer cannot be trusted or used.
 *
 * @param {string} status
 * @param {string} errorString the ErrorString property
 * @param {(text: string) => string} _ gettext
 * @returns {{text: string, detail: string, mark: string} | undefined}
 */
export function statusWords(status, errorString, _) {
    switch (status) {
        case 'unconfigured':
            return {
                text: _('Not configured'),
                detail: _('Set the instance URL and credentials in the extension settings.'),
                mark: '!',
            };
        case 'loading':
            return { text: _('Loading'), detail: '', mark: '…' };
        case 'ready':
            return { text: _('Connected'), detail: '', mark: '' };
        case 'busy':
            return { text: _('Saving'), detail: '', mark: '…' };
        case 'stale':
            return { text: _('Offline, showing the last known state'), detail: errorString, mark: '!' };
        case 'authentication-blocked':
            return { text: _('Sign-in refused'), detail: errorString, mark: '!' };
        case 'error':
            return { text: _('Error'), detail: errorString, mark: '!' };
        default:
            return undefined;
    }
}

/**
 * The words for the service's state. status is the Status property, or null
 * when nothing owns the bus name; a value the extension does not know reads
 * as an error. A service older than OLDEST_SUPPORTED_INTERFACE_VERSION gets
 * one line that asks for an update, whatever its Status. See statusWords().
 *
 * @param {string|null} status
 * @param {string} errorString the ErrorString property
 * @param {(text: string) => string} _ gettext
 * @param {number} [interfaceVersion] the InterfaceVersion property, 0 for a
 *     service without it
 * @returns {{text: string, detail: string, mark: string}}
 */
export function describeStatus(status, errorString, _, interfaceVersion = OLDEST_SUPPORTED_INTERFACE_VERSION) {
    if (status === null) {
        return {
            text: _('Timer service not running'),
            detail: _('Install tokkl-timerd, or check its log with journalctl --user -u tokkl-timerd.'),
            mark: '!',
        };
    }
    if (!supportsService(interfaceVersion)) {
        // Translators: tokkl-timerd is the name of the timer service program.
        return { text: _('This timer service is too old; update tokkl-timerd.'), detail: '', mark: '!' };
    }
    return statusWords(status, errorString, _) ?? statusWords('error', errorString, _);
}

/**
 * "Name (Client)", or the name alone when the project has no client.
 *
 * @param {{name: string, clientName?: string}} project
 * @returns {string}
 */
export function projectLabel(project) {
    return project.clientName ? `${project.name} (${project.clientName})` : project.name;
}

/**
 * The label of ChosenProject from the parts the service publishes in
 * ChosenProjectLabel, as the KDE and macOS menus word them: "No project" for
 * 0, "Unavailable project" for one the instance no longer has, "Unknown
 * project" while it has no name, and otherwise "Name (Client)" with
 * "(archived)" after it for an archived project.
 *
 * @param {number} chosenProject the ChosenProject property
 * @param {{name?: string, client?: string, archived?: boolean, missing?: boolean}} label
 *     the ChosenProjectLabel property
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function chosenProjectLabel(chosenProject, label, _) {
    if (!chosenProject) return _('No project');
    if (label.missing) return _('Unavailable project');
    if (!label.name) return _('Unknown project');
    const named = projectLabel({ name: label.name, clientName: label.client });
    // Translators: %s is the project's name, with its client in parentheses.
    return label.archived ? fill(_('%s (archived)'), named) : named;
}
