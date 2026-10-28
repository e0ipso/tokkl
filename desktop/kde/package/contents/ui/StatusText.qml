pragma ComponentBehavior: Bound

import QtQuick

import com.github.e0ipso.tokkl.backend

// Words for the timer's and the Pomodoro session's state, shared by the
// panel item, its menu and the tooltip. Every state has its own text, so
// nothing depends on color. The session is the server's, so it shows in
// either mode, whichever device started it.
QtObject {
    required property TokklTimer timer
    // Null until the backend has built it, which reads as Timer mode.
    property TokklPomodoroSession session: null

    readonly property bool pomodoroMode: session !== null && session.pomodoroMode
    // The panel shows the session rather than the timer: a session is
    // active. The timer holds no entry then, as the session owns its
    // pomodoro.
    readonly property bool showsSession: session !== null && session.active

    // The session's last message for the user, such as a pomodoro too short
    // to save or why an action did not go through; empty when there is none.
    readonly property string messageText: session !== null ? session.message : ""

    // The session in one line, such as "Short rest · 4:10 left · Pomodoro 2
    // of 4"; empty unless showsSession.
    readonly property string sessionText: {
        if (!showsSession) {
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

    // The project name for the menu title, including the archived project of
    // the running or paused entry.
    readonly property string projectText: {
        const id = timer.chosenProjectId;
        if (id === null || id === undefined) {
            return i18nc("@item:inmenu", "No project");
        }
        const project = timer.entryProject;
        if ((timer.running || timer.paused) && project && project.id === id) {
            return projectLabel(project);
        }
        for (const candidate of timer.projects) {
            if (candidate.id === id) {
                return projectLabel(candidate);
            }
        }
        return i18nc("@item:inmenu", "Unknown project");
    }

    // One line for the tooltip and the accessible description. It names the
    // project, so the panel's project indicator is never the only sign of it.
    // During a session it is the session's line.
    readonly property string summary: {
        if (showsSession) {
            return withMessage(sessionText);
        }
        const parts = [i18nc("@info:status running state and elapsed time", "%1 %2", runText, timer.elapsedText), projectText, statusText];
        if (detailText.length > 0) {
            parts.push(detailText);
        }
        return withMessage(withMode(parts.join(" · ")));
    }

    // The text, followed by the session's message when there is one.
    function withMessage(text: string): string {
        return messageText.length > 0 ? i18nc("@info:status", "%1 · %2", text, messageText) : text;
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
