pragma ComponentBehavior: Bound

import QtQuick

import com.canpicasoft.tokkl.backend

// Words for the parts TokklStatusParts picks. Each catalog returns undefined
// for an unknown key, so the panel's tests find a core key without words.
QtObject {
    id: words

    required property TokklTimer timer
    // Null reads as Timer mode.
    property TokklPomodoroSession session: null

    readonly property bool pomodoroMode: session !== null && session.pomodoroMode
    readonly property bool showsSession: parts.showsSession

    // Null leaves it out.
    property TokklLengthsSaveStatus lengthsSave: null
    // Null leaves it out.
    property TokklAlarm alarm: null

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
        const word = statusWord(parts.status);
        return word !== undefined ? word : statusWord("error");
    }

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

    readonly property string actionName: {
        const word = actionWord(parts.action);
        return word !== undefined ? word : actionWord("start");
    }

    readonly property string projectText: projectLabel(timer.chosenProjectLabel)

    readonly property TokklStatusParts parts: TokklStatusParts {
        timer: words.timer
        session: words.session
        hasMessage: words.messageText.length > 0
    }

    // Names the project, so the colour indicator is never its only sign.
    readonly property string summary: render(parts.summary)
    readonly property string accessibleDescription: render(parts.accessible)
    readonly property string menuLine: render(parts.menuLine)

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

    function withMode(text: string): string {
        return pomodoroMode ? i18nc("@info:status", "%1 · Pomodoro mode", text) : text;
    }

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

    function projectLabel(parts: var): string {
        switch (parts.kind) {
        case "none":
            return i18nc("@item:inmenu", "No project");
        case "unknown":
            return i18nc("@item:inmenu", "Unknown project");
        case "unavailable":
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
