pragma ComponentBehavior: Bound

import QtQuick

import com.canpicasoft.tokkl.backend

// Words for the timer's and the Pomodoro session's state, shared by the
// panel item, its menu and the tooltip. Every state has its own text, so
// nothing depends on color. The session is the server's, so it shows in
// either mode, whichever device started it. Which parts the summary and
// the menu's state line show, and in what order, is the core's
// (TokklStatusParts); this gives each part its words.
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

    readonly property string statusText: {
        switch (timer.status) {
        case TokklTimer.Unconfigured:
            return i18nc("@info:status", "Not configured");
        case TokklTimer.Loading:
            return i18nc("@info:status", "Loading");
        case TokklTimer.Ready:
            return i18nc("@info:status", "Connected");
        case TokklTimer.Busy:
            return i18nc("@info:status", "Saving");
        case TokklTimer.Stale:
            return i18nc("@info:status", "Offline, showing the last known state");
        case TokklTimer.AuthenticationBlocked:
            return i18nc("@info:status", "Sign-in refused");
        default:
            return i18nc("@info:status", "Error");
        }
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
        switch (parts.action) {
        case "session":
            return sessionText;
        case "pause":
            return withMode(i18nc("@action:button", "Pause the Tokkl timer"));
        case "resume":
            return withMode(i18nc("@action:button", "Resume the Tokkl timer"));
        case "startSession":
            return withMode(i18nc("@action:button", "Start a Pomodoro session"));
        default:
            return i18nc("@action:button", "Start the Tokkl timer");
        }
    }

    // The project name for the menu title, including the archived project of
    // the running or paused entry.
    readonly property string projectText: {
        const id = timer.chosenProjectId;
        if (id === null || id === undefined) {
            return i18nc("@item:inmenu", "No project");
        }
        const project = timer.chosenProjectDetails;
        return project ? projectLabel(project) : i18nc("@item:inmenu", "Unknown project");
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
            switch (key) {
            case "activity":
                shown.push(i18nc("@info:status running state and elapsed time", "%1 %2", runText, timer.elapsedText));
                break;
            case "session":
                shown.push(sessionText);
                break;
            case "project":
                shown.push(projectText);
                break;
            case "connection":
                shown.push(statusText);
                break;
            case "detail":
                shown.push(detailText);
                break;
            case "pomodoroMode":
                shown = [i18nc("@info:status", "%1 · Pomodoro mode", shown.join(" · "))];
                break;
            case "message":
                shown = [i18nc("@info:status", "%1 · %2", shown.join(" · "), messageText)];
                break;
            }
        }
        return shown.filter(text => text.length > 0).join(" · ");
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

    function projectLabel(project: var): string {
        if (project.name.length === 0) {
            // The entry names a project the instance no longer has.
            return i18nc("@item:inmenu", "Unavailable project");
        }
        let label = project.name;
        if (project.clientName && project.clientName.length > 0) {
            label = i18nc("@item:inmenu project (client)", "%1 (%2)", label, project.clientName);
        }
        if (!project.active) {
            label = i18nc("@item:inmenu", "%1 (archived)", label);
        }
        return label;
    }
}
