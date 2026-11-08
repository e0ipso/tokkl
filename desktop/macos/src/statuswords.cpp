#include "statuswords.h"

#include "statuspresentation.h"

#include <QCoreApplication>
#include <QStringList>

namespace Tokkl::StatusWords
{

namespace
{
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::StatusWords", text);
}
}

bool isNoProject(const QVariant &id)
{
    return !id.isValid() || id.isNull();
}

QString runText(const TimerModel &timer)
{
    if (timer.isRunning()) {
        return tr("Running");
    }
    return timer.isPaused() ? tr("Paused") : tr("Stopped");
}

QString statusWord(const QString &status)
{
    if (status == QLatin1String("unconfigured")) {
        return tr("Not configured");
    }
    if (status == QLatin1String("loading")) {
        return tr("Loading");
    }
    if (status == QLatin1String("ready")) {
        return tr("Connected");
    }
    if (status == QLatin1String("busy")) {
        return tr("Saving");
    }
    if (status == QLatin1String("stale")) {
        return tr("Offline, showing the last known state");
    }
    if (status == QLatin1String("authentication-blocked")) {
        return tr("Sign-in refused");
    }
    if (status == QLatin1String("error")) {
        return tr("Error");
    }
    return QString();
}

QString statusText(TimerModel::Status status)
{
    return statusWord(timerStatusKey(status));
}

QString detailText(const TimerModel &timer)
{
    switch (timer.status()) {
    case TimerModel::Unconfigured:
        return tr("Set the instance URL and credentials in Tokkl Settings.");
    case TimerModel::Ready:
    case TimerModel::Loading:
    case TimerModel::Busy:
        return QString();
    default:
        return timer.errorString();
    }
}

QString projectLabel(const ProjectLabelParts &parts)
{
    if (parts.missing) {
        // The entry names a project the instance no longer has.
        return tr("Unavailable project");
    }
    QString label = parts.name;
    if (!parts.client.isEmpty()) {
        label = tr("%1 (%2)").arg(label, parts.client);
    }
    if (parts.archived) {
        label = tr("%1 (archived)").arg(label);
    }
    return label;
}

QString projectText(const TimerModel &timer)
{
    if (isNoProject(timer.chosenProjectId())) {
        return tr("No project");
    }
    const ProjectLabelParts parts = timer.chosenProjectLabel();
    return parts.name.isEmpty() && !parts.missing ? tr("Unknown project") : projectLabel(parts);
}


QString phaseName(const QString &phase)
{
    const std::optional<PhaseKind> kind = parsePhaseKind(phase);
    if (!kind) {
        return QString();
    }
    switch (*kind) {
    case PhaseKind::Work:
        return tr("Work");
    case PhaseKind::ShortRest:
        return tr("Short rest");
    case PhaseKind::LongRest:
        return tr("Long rest");
    }
    return QString();
}

QString sessionText(const PomodoroSession &session)
{
    // countdownText already starts with + in overtime.
    const QString time = session.remainingSeconds() > 0 ? tr("%1 left").arg(session.countdownText()) : tr("%1 overtime").arg(session.countdownText());
    return tr("%1 · %2 · Pomodoro %3 of %4")
        .arg(phaseName(session.phase()), time, QString::number(session.pomodoroNumber()), QString::number(session.longRestEvery()));
}

QString actionName(const QString &action, const PomodoroSession &session)
{
    if (action == QLatin1String("start")) {
        return tr("Start the Tokkl timer");
    }
    if (action == QLatin1String("pause")) {
        return tr("Pause the Tokkl timer");
    }
    if (action == QLatin1String("resume")) {
        return tr("Resume the Tokkl timer");
    }
    if (action == QLatin1String("startSession")) {
        return tr("Start a Pomodoro session");
    }
    if (action == QLatin1String("session")) {
        return sessionText(session);
    }
    return QString();
}

std::optional<QStringList> withPart(const QString &part, QStringList words, const TimerModel &timer, const PomodoroSession &session)
{
    if (part == QLatin1String("activity")) {
        words.append(tr("%1 %2").arg(runText(timer), timer.elapsedText()));
    } else if (part == QLatin1String("session")) {
        words.append(sessionText(session));
    } else if (part == QLatin1String("project")) {
        words.append(projectText(timer));
    } else if (part == QLatin1String("connection")) {
        words.append(statusText(timer.status()));
    } else if (part == QLatin1String("detail")) {
        words.append(detailText(timer));
    } else if (part == QLatin1String("pomodoroMode")) {
        words = QStringList{tr("%1 · Pomodoro mode").arg(words.join(QStringLiteral(" · ")))};
    } else if (part != QLatin1String("message")) {
        // The menu shows the session's message on a line of its own; any
        // other key has no words.
        return std::nullopt;
    }
    return words;
}

namespace
{
StatusPresentation presentation(const TimerModel &timer, const PomodoroSession &session)
{
    return StatusPresentation::of(StatusInput::of(timer, &session), StatusPolicy::macos());
}

// The words of the parts, joined by " · ".
QString render(const QList<StatusPart> &parts, const TimerModel &timer, const PomodoroSession &session)
{
    QStringList words;
    for (const StatusPart part : parts) {
        words = withPart(statusPartKey(part), words, timer, session).value_or(words);
    }
    return words.join(QStringLiteral(" · "));
}
}

QString summary(const TimerModel &timer, const PomodoroSession &session)
{
    return render(presentation(timer, session).summary, timer, session);
}

QString menuLine(const TimerModel &timer, const PomodoroSession &session)
{
    return render(presentation(timer, session).menuLine, timer, session);
}

QString menuBarTitle(const TimerModel &timer, const PomodoroSession &session)
{
    const QString time = StatusInput::of(timer, &session).showsSession ? session.countdownText() : timer.elapsedText();
    switch (presentation(timer, session).mark) {
    case StatusMark::None:
        return time;
    case StatusMark::Pending:
        return tr("%1 …").arg(time);
    case StatusMark::Alert:
        return tr("%1 !").arg(time);
    case StatusMark::Unconfigured:
        return tr("Tokkl");
    }
    return time;
}

QString itemName(const TimerModel &timer, const PomodoroSession &session)
{
    // The core decides what the click does; the name says it.
    const QString action = primaryActionKey(session.primaryAction());
    if (action == QLatin1String("session")) {
        return actionName(action, session);
    }
    if (!session.pomodoroMode()) {
        return tr("%1, %2").arg(actionName(action, session), projectText(timer));
    }
    return tr("%1, %2 · Pomodoro mode").arg(actionName(action, session), projectText(timer));
}

}
