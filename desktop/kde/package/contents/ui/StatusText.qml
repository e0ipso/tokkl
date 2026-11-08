pragma ComponentBehavior: Bound

import QtQuick

import com.canpicasoft.tokkl.backend

// Words for the timer's and the Pomodoro session's state, shared by the
// panel item, its menu and the tooltip. Every state has its own text, so
// nothing depends on color. The session is the server's, so it shows in
// either mode, whichever device started it. Which parts the summary and
// the menu's state line show, and in what order, is the core's
// (TokklStatusParts); this gives each part its words. The words are keyed
// on the core's keys (partKeys, statusKeys and actionKeys of
// TokklStatusParts), and each catalog gives undefined for a key it does not
// know, so the panel's tests find a core key without words.
QtObject {
    id: words

    required property TokklTimer timer
    // Null until the backend has built it, which reads as Timer mode.
    property TokklPomodoroSession session: null

    readonly property bool pomodoroMode: session !== null && session.pomodoroMode
    // The panel shows the session rather than the timer: a session is
    // active and no timer runs or is paused, by the core's rule.
    readonly property bool showsSession: parts.showsSession

    // The last refusal of a Pomodoro lengths save from the settings page,
    // which may come after the dialog has closed. Null leaves it out.
    property TokklLengthsSaveStatus lengthsSave: null
    // The panel's alarm, whose error says why a ring was silent. Null leaves
    // it out.
    property TokklAlarm alarm: null

    // The session's last message for the user, such as a pomodoro too short
    // to save or why an action did not go through, or else why the
    // Pomodoro lengths were not saved, or else why the alarm was silent;
    // empty when there is none.
    readonly property string messageText: {
        if (session !== null && session.message.length > 0) {
            return session.message;
        }
        if (lengthsSave !== null && lengthsSave.refusal.length > 0) {
            return i18nc("@info:status %1 is the server's reason", "Pomodoro lengths not saved: %1", lengthsSave.refusal);
        }
        if (alarm !== null && alarm.error.length > 0) {
            return alarm.error;
        }
        return "";
    }

    // The session in one line, such as "Short rest · 4:10 left · Pomodoro 2
    // of 4"; empty without an active session.
    readonly property string sessionText: {
        if (session === null || !session.active) {
            return "";
        }
        // countdownText already starts with + in overtime.
        const time = session.remainingSeconds > 0 ? i18nc("@info:status countdown to the end of the phase", "%1 left", session.countdownText) : i18nc("@info:status time past the end of the phase", "%1 overtime", session.countdownText);
        return i18nc("@info:status phase, time left or overtime, pomodoro of the round", "%1 · %2 · Pomodoro %3 of %4", phaseName(session.phase), time, session.pomodoroNumber, session.longRestEvery);
    }

    readonly property string nextPhaseText: i18nc("@action:inmenu", "Next phase: %1", phaseName(session !== null ? session.nextPhase : ""))

    readonly property string modeText: session !== null && session.modeLocked ? i18nc("@option:check", "Pomodoro mode (locked while running)") : i18nc("@option:check", "Pomodoro mode")

    readonly property string runText: {
        if (timer.running) {
            return i18nc("@info:status timer", "Running");
        }
        return timer.paused ? i18nc("@info:status timer", "Paused") : i18nc("@info:status timer", "Stopped");
    }

    // The connection's state, for the timer's status as the core keys it.
    readonly property string statusText: {
        const word = statusWord(parts.status);
        return word !== undefined ? word : statusWord("error");
    }

    // A longer explanation, or empty.
    readonly property string detailText: {
        switch (timer.status) {
        case TokklTimer.Unconfigured:
            return i18n("Set the instance URL and credentials in the widget settings.");
        case TokklTimer.Ready:
        case TokklTimer.Loading:
        case TokklTimer.Busy:
            return "";
        default:
            return timer.errorString;
        }
    }

    // The panel button's accessible name: what the primary click does, as
    // the core decides it (parts.action), or the session's line while the
    // click acts on the session.
    readonly property string actionName: {
        const word = actionWord(parts.action);
        return word !== undefined ? word : actionWord("start");
    }

    // The project name for the menu title, including the archived project of
    // the running or paused entry.
    readonly property string projectText: {
        const id = timer.chosenProjectId;
        if (id === null || id === undefined) {
            return i18nc("@item:inmenu", "No project");
        }
        const parts = timer.chosenProjectLabel;
        return parts.name.length > 0 || parts.missing ? projectLabel(parts) : i18nc("@item:inmenu", "Unknown project");
    }

    readonly property TokklStatusParts parts: TokklStatusParts {
        timer: words.timer
        session: words.session
        hasMessage: words.messageText.length > 0
    }

    // One line for the tooltip. It names the project, so the panel's
    // project indicator is never the only sign of it. During a session it is
    // the session's line.
    readonly property string summary: render(parts.summary)
    // The panel button's accessible description: the summary, or during a
    // session, whose line is the button's name, the project and the
    // connection's state, which the session's line leaves out.
    readonly property string accessibleDescription: render(parts.accessible)
    // The menu's state line: the run state, the elapsed time and the
    // connection's state, or the session's line.
    readonly property string menuLine: render(parts.menuLine)

    // The words of the parts, joined by " · ".
    function render(keys: var): string {
        let shown = [];
        for (const key of keys) {
            const next = partWords(key, shown);
            if (next !== undefined) {
                shown = next;
            }
        }
        return shown.filter(text => text.length > 0).join(" · ");
    }

    // The words so far with the part of a part key added; undefined for any
    // other key.
    function partWords(key: string, shown: var): var {
        switch (key) {
        case "activity":
            return shown.concat([i18nc("@info:status running state and elapsed time", "%1 %2", runText, timer.elapsedText)]);
        case "session":
            return shown.concat([sessionText]);
        case "project":
            return shown.concat([projectText]);
        case "connection":
            return shown.concat([statusText]);
        case "detail":
            return shown.concat([detailText]);
        case "pomodoroMode":
            return [i18nc("@info:status", "%1 · Pomodoro mode", shown.join(" · "))];
        case "message":
            return [i18nc("@info:status", "%1 · %2", shown.join(" · "), messageText)];
        default:
            return undefined;
        }
    }

    // The connection's state for a status key; undefined for any other key.
    function statusWord(key: string): var {
        switch (key) {
        case "unconfigured":
            return i18nc("@info:status", "Not configured");
        case "loading":
            return i18nc("@info:status", "Loading");
        case "ready":
            return i18nc("@info:status", "Connected");
        case "busy":
            return i18nc("@info:status", "Saving");
        case "stale":
            return i18nc("@info:status", "Offline, showing the last known state");
        case "authentication-blocked":
            return i18nc("@info:status", "Sign-in refused");
        case "error":
            return i18nc("@info:status", "Error");
        default:
            return undefined;
        }
    }

    // What the primary click does, for an action key, or the session's line
    // while it acts on the session; undefined for any other key.
    function actionWord(key: string): var {
        switch (key) {
        case "session":
            return sessionText;
        case "pause":
            return withMode(i18nc("@action:button", "Pause the Tokkl timer"));
        case "resume":
            return withMode(i18nc("@action:button", "Resume the Tokkl timer"));
        case "startSession":
            return withMode(i18nc("@action:button", "Start a Pomodoro session"));
        case "start":
            return i18nc("@action:button", "Start the Tokkl timer");
        default:
            return undefined;
        }
    }

    // The text, marked in Pomodoro mode.
    function withMode(text: string): string {
        return pomodoroMode ? i18nc("@info:status", "%1 · Pomodoro mode", text) : text;
    }

    // Work, Short rest or Long rest for a phase as the session names it.
    function phaseName(phase: string): string {
        switch (phase) {
        case "work":
            return i18nc("@info:status Pomodoro phase", "Work");
        case "shortRest":
            return i18nc("@info:status Pomodoro phase", "Short rest");
        case "longRest":
            return i18nc("@info:status Pomodoro phase", "Long rest");
        default:
            return "";
        }
    }

    // The words for the parts of a project's label, as the core gives them
    // (TokklTimer.chosenProjectLabel, or a project row's label).
    function projectLabel(parts: var): string {
        if (parts.missing) {
            // The entry names a project the instance no longer has.
            return i18nc("@item:inmenu", "Unavailable project");
        }
        let label = parts.name;
        if (parts.client.length > 0) {
            label = i18nc("@item:inmenu project (client)", "%1 (%2)", label, parts.client);
        }
        if (parts.archived) {
            label = i18nc("@item:inmenu", "%1 (archived)", label);
        }
        return label;
    }
}
