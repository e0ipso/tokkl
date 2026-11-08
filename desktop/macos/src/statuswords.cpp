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

QString statusText(TimerModel::Status status)
{
    switch (status) {
    case TimerModel::Unconfigured:
        return tr("Not configured");
    case TimerModel::Loading:
        return tr("Loading");
    case TimerModel::Ready:
        return tr("Connected");
    case TimerModel::Busy:
        return tr("Saving");
    case TimerModel::Stale:
        return tr("Offline, showing the last known state");
    case TimerModel::AuthenticationBlocked:
        return tr("Sign-in refused");
    case TimerModel::Error:
        break;
    }
    return tr("Error");
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

QString projectLabel(const QVariantMap &project)
{
    const QString name = project.value(QStringLiteral("name")).toString();
    if (name.isEmpty()) {
        // The entry names a project the instance no longer has.
        return tr("Unavailable project");
    }
    QString label = name;
    const QString client = project.value(QStringLiteral("clientName")).toString();
    if (!client.isEmpty()) {
        label = tr("%1 (%2)").arg(label, client);
    }
    if (!project.value(QStringLiteral("active")).toBool()) {
        label = tr("%1 (archived)").arg(label);
    }
    return label;
}

QString projectText(const TimerModel &timer)
{
    if (isNoProject(timer.chosenProjectId())) {
        return tr("No project");
    }
    const QVariant details = timer.chosenProjectDetails();
    return details.isNull() ? tr("Unknown project") : projectLabel(details.toMap());
}

QString actionName(PrimaryAction action)
{
    switch (action) {
    case PrimaryAction::Pause:
        return tr("Pause the Tokkl timer");
    case PrimaryAction::Resume:
        return tr("Resume the Tokkl timer");
    case PrimaryAction::StartSession:
        return tr("Start a Pomodoro session");
    case PrimaryAction::Start:
    case PrimaryAction::Session:
        break;
    }
    return tr("Start the Tokkl timer");
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
        switch (part) {
        case StatusPart::Activity:
            words.append(tr("%1 %2").arg(runText(timer), timer.elapsedText()));
            break;
        case StatusPart::Session:
            words.append(sessionText(session));
            break;
        case StatusPart::Project:
            words.append(projectText(timer));
            break;
        case StatusPart::Connection:
            words.append(statusText(timer.status()));
            break;
        case StatusPart::Detail:
            words.append(detailText(timer));
            break;
        case StatusPart::PomodoroMode:
            words = QStringList{tr("%1 · Pomodoro mode").arg(words.join(QStringLiteral(" · ")))};
            break;
        case StatusPart::Message:
            // The menu shows the session's message on a line of its own.
            break;
        }
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
    const PrimaryAction action = session.primaryAction();
    if (action == PrimaryAction::Session) {
        return sessionText(session);
    }
    if (!session.pomodoroMode()) {
        return tr("%1, %2").arg(actionName(action), projectText(timer));
    }
    return tr("%1, %2 · Pomodoro mode").arg(actionName(action), projectText(timer));
}

}
