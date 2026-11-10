// Text for the org.tokkl.Timer1 properties. tokkl-timerd owns every timer rule.
// Nothing here imports GNOME Shell or GTK, so Node runs the tests.

export const BUS_NAME = 'org.tokkl.Timer1';
export const OBJECT_PATH = '/org/tokkl/Timer1';

// pack-extension.sh copies it from desktop/gnome/dbus, the contract's one source.
export const TIMER1_XML_FILE = 'org.tokkl.Timer1.xml';

export const AUTH_MODES = ['token', 'password'];

// Version 2 is the first released one. A service below it, or without
// InterfaceVersion (tokkl-timerd 2.1.0 and older), gets only an update prompt.
export const OLDEST_SUPPORTED_INTERFACE_VERSION = 2;

export function supportsService(interfaceVersion) {
    return interfaceVersion >= OLDEST_SUPPORTED_INTERFACE_VERSION;
}

export function serviceRunning(proxy) {
    return Boolean(proxy?.g_name_owner);
}

// A proxy without a name owner keeps no properties, so this returns the fallback.
export function cachedProperty(proxy, name, fallback) {
    if (!serviceRunning(proxy)) return fallback;
    const value = proxy.get_cached_property(name);
    return value ? value.recursiveUnpack() : fallback;
}

export function interfaceVersion(proxy) {
    return cachedProperty(proxy, 'InterfaceVersion', 0);
}

export function serviceOutdated(proxy) {
    return serviceRunning(proxy) && !supportsService(interfaceVersion(proxy));
}

export function supportedProperty(proxy, name, fallback) {
    return serviceOutdated(proxy) ? fallback : cachedProperty(proxy, name, fallback);
}

// Skips a stopped service, which the call would start, and an outdated one.
// A failed check has nothing to show, so it is only logged.
export function refreshProjectsOnOpen(open, proxy) {
    if (!open || !serviceRunning(proxy) || serviceOutdated(proxy)) return false;
    proxy.RefreshProjectsRemote((_result, error) => {
        if (error) console.warn(`Tokkl: RefreshProjects failed: ${error.message}`);
    });
    return true;
}

// startTime is LocalStartTime: Unix seconds on this machine's clock, or 0.
export function elapsedSeconds(startTime, nowSeconds) {
    if (!(startTime > 0)) return 0;
    return Math.max(0, Math.floor(nowSeconds) - startTime);
}

// Seconds are dropped, not rounded, as in the other Tokkl desktop apps.
export function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

// Minutes are not wrapped: three hours is 180:00.
function minutesAndSeconds(seconds) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// %1$s takes the value at that position, a plain %s the next one. GNOME Shell's
// String.prototype.format has no positions and does not exist under Node.
export function fill(template, ...values) {
    let next = 0;
    return template.replace(/%(?:([1-9][0-9]*)\$)?[sd]/g, (_match, position) =>
        String(position ? values[Number(position) - 1] : values[next++]),
    );
}

// Rounds up before plannedEnd and down in overtime. Display only: the service
// decides when a phase rings.
export function countdown(plannedEnd, nowSeconds) {
    const ms = Math.round((plannedEnd - nowSeconds) * 1000);
    if (ms > 0) return { text: minutesAndSeconds(Math.ceil(ms / 1000)), overtime: false };
    return { text: `+${minutesAndSeconds(Math.floor(-ms / 1000))}`, overtime: true };
}

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

// Worded as in the KDE and macOS apps: "Work · +1:02 overtime · Pomodoro 3 of 4".
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

export function nextPhaseLabel(upcomingPhase, _) {
    // Translators: %s is the phase NextPhase starts: Work, Short rest or Long rest.
    return fill(_('Next phase: %s'), phaseName(upcomingPhase, _));
}

export function pomodoroModeLabel(locked, _) {
    return locked ? _('Pomodoro mode (locked while running)') : _('Pomodoro mode');
}

// Keys match timerStatusKeys() in desktop/core/src/statuspresentation.h. mark
// ends the panel time: '' ready, '…' loading or saving, '!' unusable.
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

export function outdatedServiceText(_) {
    // Translators: tokkl-timerd is the name of the timer service program.
    return _('This timer service is too old; update tokkl-timerd.');
}

// status is null when nothing owns the bus name. An unknown status reads as an error.
export function describeStatus(status, errorString, _, interfaceVersion = OLDEST_SUPPORTED_INTERFACE_VERSION) {
    if (status === null) {
        return {
            text: _('Timer service not running'),
            detail: _('Install tokkl-timerd, or check its log with journalctl --user -u tokkl-timerd.'),
            mark: '!',
        };
    }
    if (!supportsService(interfaceVersion)) return { text: outdatedServiceText(_), detail: '', mark: '!' };
    return statusWords(status, errorString, _) ?? statusWords('error', errorString, _);
}

export function projectLabel(project) {
    return project.clientName ? `${project.name} (${project.clientName})` : project.name;
}

// Worded as the KDE and macOS menus word ChosenProjectLabel.
export function chosenProjectLabel(label, _) {
    switch (label.kind ?? 'none') {
        case 'none':
            return _('No project');
        case 'named':
            break;
        case 'unavailable':
            return _('Unavailable project');
        default:
            return _('Unknown project');
    }
    const named = projectLabel({ name: label.name, clientName: label.client });
    // Translators: %s is the project's name, with its client in parentheses.
    return label.archived ? fill(_('%s (archived)'), named) : named;
}
