#include "statuswords.h"

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

bool isNullId(const QVariant &id)
{
    return !id.isValid() || id.isNull();
}
}

QString runText(const TimerController &timer)
{
    if (timer.isRunning()) {
        return tr("Running");
    }
    return timer.isPaused() ? tr("Paused") : tr("Stopped");
}

QString statusText(TimerController::Status status)
{
    switch (status) {
    case TimerController::Unconfigured:
        return tr("Not configured");
    case TimerController::Loading:
        return tr("Loading");
    case TimerController::Ready:
        return tr("Connected");
    case TimerController::Busy:
        return tr("Saving");
    case TimerController::Stale:
        return tr("Offline, showing the last known state");
    case TimerController::AuthenticationBlocked:
        return tr("Sign-in refused");
    case TimerController::Error:
        break;
    }
    return tr("Error");
}

QString detailText(const TimerController &timer)
{
    switch (timer.status()) {
    case TimerController::Unconfigured:
        return tr("Set the instance URL and credentials in Tokkl Settings.");
    case TimerController::Ready:
    case TimerController::Loading:
    case TimerController::Busy:
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

QString projectText(const TimerController &timer)
{
    const QVariant id = timer.chosenProjectId();
    if (isNullId(id)) {
        return tr("No project");
    }
    const qint64 projectId = id.toLongLong();
    const QVariantMap entryProject = timer.entryProjectVariant().toMap();
    if ((timer.isRunning() || timer.isPaused()) && !entryProject.isEmpty() && entryProject.value(QStringLiteral("id")).toLongLong() == projectId) {
        return projectLabel(entryProject);
    }
    const QVariantList projects = timer.projects();
    for (const QVariant &candidate : projects) {
        const QVariantMap project = candidate.toMap();
        if (project.value(QStringLiteral("id")).toLongLong() == projectId) {
            return projectLabel(project);
        }
    }
    return tr("Unknown project");
}

QString summary(const TimerController &timer)
{
    QStringList parts{tr("%1 %2").arg(runText(timer), timer.elapsedText()), projectText(timer), statusText(timer.status())};
    const QString detail = detailText(timer);
    if (!detail.isEmpty()) {
        parts.append(detail);
    }
    return parts.join(QStringLiteral(" · "));
}

QString menuBarTitle(const TimerController &timer)
{
    switch (timer.status()) {
    case TimerController::Unconfigured:
        return tr("Tokkl");
    case TimerController::Ready:
        return timer.elapsedText();
    case TimerController::Loading:
    case TimerController::Busy:
        return tr("%1 …").arg(timer.elapsedText());
    default:
        return tr("%1 !").arg(timer.elapsedText());
    }
}

QString actionName(const TimerController &timer)
{
    if (timer.isRunning()) {
        return tr("Pause the Tokkl timer");
    }
    return timer.isPaused() ? tr("Resume the Tokkl timer") : tr("Start the Tokkl timer");
}

QString itemName(const TimerController &timer)
{
    return tr("%1, %2").arg(actionName(timer), projectText(timer));
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

QString sessionLine(const TimerController &timer, const PomodoroSession &session)
{
    const QString text = sessionText(session);
    if (timer.status() == TimerController::Ready) {
        return text;
    }
    return tr("%1 · %2").arg(text, statusText(timer.status()));
}

bool showsSession(const TimerController &timer, const PomodoroSession &session)
{
    return session.isActive() && !timer.isRunning() && !timer.isPaused();
}

QString summary(const TimerController &timer, const PomodoroSession &session)
{
    if (showsSession(timer, session)) {
        return sessionLine(timer, session);
    }
    return session.pomodoroMode() ? tr("%1 · Pomodoro mode").arg(summary(timer)) : summary(timer);
}

QString menuBarTitle(const TimerController &timer, const PomodoroSession &session)
{
    if (!showsSession(timer, session)) {
        return menuBarTitle(timer);
    }
    switch (timer.status()) {
    case TimerController::Stale:
    case TimerController::AuthenticationBlocked:
    case TimerController::Error:
        return tr("%1 !").arg(session.countdownText());
    default:
        return session.countdownText();
    }
}

QString itemName(const TimerController &timer, const PomodoroSession &session)
{
    if (showsSession(timer, session)) {
        return sessionText(session);
    }
    if (!session.pomodoroMode()) {
        return itemName(timer);
    }
    const QString action = timer.isRunning() || timer.isPaused() ? actionName(timer) : tr("Start a Pomodoro session");
    return tr("%1, %2 · Pomodoro mode").arg(action, projectText(timer));
}

}
