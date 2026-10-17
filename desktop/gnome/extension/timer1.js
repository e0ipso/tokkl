// The org.tokkl.Timer1 contract as the extension and its preferences see it,
// and the words and numbers they show for it. Nothing here imports from GNOME
// Shell or GTK, so Node runs its tests.
//
// tokkl-timerd owns every rule of the timer. These helpers only turn the
// properties it publishes into text.

export const BUS_NAME = 'org.tokkl.Timer1';
export const OBJECT_PATH = '/org/tokkl/Timer1';

// desktop/gnome/dbus/org.tokkl.Timer1.xml without its comments. The tests
// fail when the two differ.
export const TIMER1_INTERFACE = `<node>
  <interface name="org.tokkl.Timer1">
    <property name="Running" type="b" access="read"/>
    <property name="StartTime" type="x" access="read"/>
    <property name="IndicatorState" type="s" access="read"/>
    <property name="IndicatorColor" type="s" access="read"/>
    <property name="Projects" type="aa{sv}" access="read"/>
    <property name="ChosenProject" type="x" access="read"/>
    <property name="Billable" type="b" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="ErrorString" type="s" access="read"/>
    <method name="Start">
      <arg name="sent" type="b" direction="out"/>
    </method>
    <method name="Stop">
      <arg name="sent" type="b" direction="out"/>
    </method>
    <method name="SetProject">
      <arg name="projectId" type="x" direction="in"/>
      <arg name="accepted" type="b" direction="out"/>
    </method>
    <method name="SetBillable">
      <arg name="billable" type="b" direction="in"/>
      <arg name="accepted" type="b" direction="out"/>
    </method>
    <method name="Configure">
      <arg name="instanceUrl" type="s" direction="in"/>
      <arg name="authMode" type="s" direction="in"/>
      <arg name="email" type="s" direction="in"/>
      <arg name="secret" type="s" direction="in"/>
    </method>
  </interface>
</node>`;

// The values of Configure's authMode argument.
export const AUTH_MODES = ['token', 'password'];

/**
 * Seconds since startTime, never negative. startTime is the StartTime
 * property: Unix seconds, or 0 when no entry runs.
 *
 * @param {number} startTime
 * @param {number} nowSeconds the current Unix time in seconds
 * @returns {number}
 */
export function elapsedSeconds(startTime, nowSeconds) {
    if (!(startTime > 0))
        return 0;
    return Math.max(0, Math.floor(nowSeconds) - startTime);
}

/**
 * H:MM:SS, as the other Tokkl desktop apps write elapsed time.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * The words for the service's state. status is the Status property, or null
 * when nothing owns the bus name. detail is empty or a longer explanation;
 * mark says how the panel time ends: '' when ready, '…' while loading or
 * saving, '!' when the timer cannot be trusted or used.
 *
 * @param {string|null} status
 * @param {string} errorString the ErrorString property
 * @param {(text: string) => string} _ gettext
 * @returns {{text: string, detail: string, mark: string}}
 */
export function describeStatus(status, errorString, _) {
    switch (status) {
    case null:
        return {
            text: _('Timer service not running'),
            detail: _('Install tokkl-timerd, or check its log with journalctl --user -u tokkl-timerd.'),
            mark: '!',
        };
    case 'unconfigured':
        return {
            text: _('Not configured'),
            detail: _('Set the instance URL and credentials in the extension settings.'),
            mark: '!',
        };
    case 'loading':
        return {text: _('Loading'), detail: '', mark: '…'};
    case 'ready':
        return {text: _('Connected'), detail: '', mark: ''};
    case 'busy':
        return {text: _('Saving'), detail: '', mark: '…'};
    case 'stale':
        return {text: _('Offline, showing the last known state'), detail: errorString, mark: '!'};
    case 'authentication-blocked':
        return {text: _('Sign-in refused'), detail: errorString, mark: '!'};
    default:
        return {text: _('Error'), detail: errorString, mark: '!'};
    }
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
 * The label of ChosenProject: "No project" for 0, the project's label when it
 * is in Projects, and "Unavailable project" otherwise (an entry on a project
 * the workspace no longer lists).
 *
 * @param {Array<{id: number, name: string, clientName?: string}>} projects
 * @param {number} chosenProject
 * @param {(text: string) => string} _ gettext
 * @returns {string}
 */
export function chosenProjectLabel(projects, chosenProject, _) {
    if (!chosenProject)
        return _('No project');
    const project = projects.find(candidate => candidate.id === chosenProject);
    return project ? projectLabel(project) : _('Unavailable project');
}
