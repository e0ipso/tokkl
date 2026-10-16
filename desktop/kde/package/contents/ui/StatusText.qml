pragma ComponentBehavior: Bound

import QtQuick

import com.github.e0ipso.tokkl.backend

// Words for the timer's state, shared by the panel item, its menu and the
// tooltip. Every state has its own text, so nothing depends on color.
QtObject {
    required property TokklTimer timer

    readonly property string runText: timer.running ? i18nc("@info:status timer", "Running") : i18nc("@info:status timer", "Stopped")

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

    // The project name for the menu title, including an archived one.
    readonly property string projectText: {
        const id = timer.chosenProjectId;
        if (id === null || id === undefined) {
            return i18nc("@item:inmenu", "No project");
        }
        const project = timer.entryProject;
        if (timer.running && project && project.id === id) {
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
    readonly property string summary: {
        const parts = [i18nc("@info:status running state and elapsed time", "%1 %2", runText, timer.elapsedText), projectText, statusText];
        if (detailText.length > 0) {
            parts.push(detailText);
        }
        return parts.join(" · ");
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
