#include "statuspresentation.h"

#include "pomodorosession.h"

namespace Tokkl
{

QString statusPartKey(StatusPart part)
{
    switch (part) {
    case StatusPart::Activity:
        return QStringLiteral("activity");
    case StatusPart::Session:
        return QStringLiteral("session");
    case StatusPart::Project:
        return QStringLiteral("project");
    case StatusPart::Connection:
        return QStringLiteral("connection");
    case StatusPart::Detail:
        return QStringLiteral("detail");
    case StatusPart::PomodoroMode:
        return QStringLiteral("pomodoroMode");
    case StatusPart::Message:
        return QStringLiteral("message");
    }
    return QString();
}

QString statusMarkKey(StatusMark mark)
{
    switch (mark) {
    case StatusMark::None:
        return QStringLiteral("none");
    case StatusMark::Pending:
        return QStringLiteral("pending");
    case StatusMark::Alert:
        return QStringLiteral("alert");
    case StatusMark::Unconfigured:
        return QStringLiteral("unconfigured");
    }
    return QString();
}

StatusInput StatusInput::of(const TimerModel &timer, const PomodoroSession *session, bool hasMessage)
{
    StatusInput input;
    input.status = timer.status();
    switch (input.status) {
    case TimerModel::Unconfigured:
        input.hasDetail = true;
        break;
    case TimerModel::Ready:
    case TimerModel::Loading:
    case TimerModel::Busy:
        break;
    default:
        input.hasDetail = !timer.errorString().isEmpty();
        break;
    }
    input.paused = timer.isPaused();
    input.showsSession = session && session->isActive() && !timer.isRunning() && !timer.isPaused();
    input.pomodoroMode = session && session->pomodoroMode();
    input.hasMessage = hasMessage;
    return input;
}

StatusPolicy StatusPolicy::plasma()
{
    StatusPolicy policy;
    policy.summaryMessage = true;
    return policy;
}

StatusPolicy StatusPolicy::macos()
{
    StatusPolicy policy;
    policy.sessionMarksAlertOnly = true;
    return policy;
}

StatusPolicy StatusPolicy::gnome()
{
    StatusPolicy policy;
    policy.summarySessionConnection = SessionConnection::Always;
    policy.summarySessionProject = true;
    policy.summarySessionDetail = true;
    policy.menuSessionConnection = SessionConnection::Never;
    policy.menuActivityOnlyWhilePaused = true;
    return policy;
}

namespace
{
bool namesConnection(StatusPolicy::SessionConnection rule, TimerModel::Status status)
{
    switch (rule) {
    case StatusPolicy::SessionConnection::Never:
        return false;
    case StatusPolicy::SessionConnection::UnlessReady:
        return status != TimerModel::Ready;
    case StatusPolicy::SessionConnection::Always:
        return true;
    }
    return false;
}

QList<StatusPart> summaryOf(const StatusInput &input, const StatusPolicy &policy)
{
    QList<StatusPart> parts;
    if (input.showsSession) {
        parts.append(StatusPart::Session);
        if (policy.summarySessionProject) {
            parts.append(StatusPart::Project);
        }
        if (namesConnection(policy.summarySessionConnection, input.status)) {
            parts.append(StatusPart::Connection);
            if (policy.summarySessionDetail && input.hasDetail) {
                parts.append(StatusPart::Detail);
            }
        }
    } else {
        parts.append({StatusPart::Activity, StatusPart::Project, StatusPart::Connection});
        if (input.hasDetail) {
            parts.append(StatusPart::Detail);
        }
        if (input.pomodoroMode) {
            parts.append(StatusPart::PomodoroMode);
        }
    }
    if (policy.summaryMessage && input.hasMessage) {
        parts.append(StatusPart::Message);
    }
    return parts;
}

QList<StatusPart> accessibleOf(const StatusInput &input, const StatusPolicy &policy, const QList<StatusPart> &summary)
{
    if (!input.showsSession) {
        return summary;
    }
    QList<StatusPart> parts{StatusPart::Project};
    if (namesConnection(policy.summarySessionConnection, input.status)) {
        parts.append(StatusPart::Connection);
        if (input.hasDetail) {
            parts.append(StatusPart::Detail);
        }
    }
    if (policy.summaryMessage && input.hasMessage) {
        parts.append(StatusPart::Message);
    }
    return parts;
}

QList<StatusPart> menuLineOf(const StatusInput &input, const StatusPolicy &policy)
{
    if (input.showsSession) {
        if (namesConnection(policy.menuSessionConnection, input.status)) {
            return {StatusPart::Session, StatusPart::Connection};
        }
        return {StatusPart::Session};
    }
    if (policy.menuActivityOnlyWhilePaused && !input.paused) {
        return {StatusPart::Connection};
    }
    return {StatusPart::Activity, StatusPart::Connection};
}

StatusMark markOf(const StatusInput &input, const StatusPolicy &policy)
{
    switch (input.status) {
    case TimerModel::Ready:
        return StatusMark::None;
    case TimerModel::Loading:
    case TimerModel::Busy:
        return input.showsSession && policy.sessionMarksAlertOnly ? StatusMark::None : StatusMark::Pending;
    case TimerModel::Unconfigured:
        return input.showsSession && policy.sessionMarksAlertOnly ? StatusMark::None : StatusMark::Unconfigured;
    case TimerModel::Stale:
    case TimerModel::AuthenticationBlocked:
    case TimerModel::Error:
        break;
    }
    return StatusMark::Alert;
}

QStringList keys(const QList<StatusPart> &parts)
{
    QStringList keys;
    for (const StatusPart part : parts) {
        keys.append(statusPartKey(part));
    }
    return keys;
}
}

StatusPresentation StatusPresentation::of(const StatusInput &input, const StatusPolicy &policy)
{
    const QList<StatusPart> summary = summaryOf(input, policy);
    return StatusPresentation{summary, menuLineOf(input, policy), accessibleOf(input, policy, summary), markOf(input, policy)};
}

QVariantMap StatusPresentation::toVariantMap() const
{
    return {
        {QStringLiteral("summary"), keys(summary)},
        {QStringLiteral("menuLine"), keys(menuLine)},
        {QStringLiteral("mark"), statusMarkKey(mark)},
    };
}

StatusParts::StatusParts(QObject *parent)
    : QObject(parent)
{
}

TimerModel *StatusParts::timer() const
{
    return m_timer;
}

void StatusParts::setTimer(TimerModel *timer)
{
    if (timer == m_timer) {
        return;
    }
    m_timer = timer;
    watch();
    Q_EMIT timerChanged();
    update();
}

PomodoroSession *StatusParts::session() const
{
    return m_session;
}

void StatusParts::setSession(PomodoroSession *session)
{
    if (session == m_session) {
        return;
    }
    m_session = session;
    watch();
    Q_EMIT sessionChanged();
    update();
}

bool StatusParts::hasMessage() const
{
    return m_hasMessage;
}

void StatusParts::setHasMessage(bool hasMessage)
{
    if (hasMessage == m_hasMessage) {
        return;
    }
    m_hasMessage = hasMessage;
    Q_EMIT hasMessageChanged();
    update();
}

const StatusPresentation &StatusParts::presentation() const
{
    return m_presentation;
}

QStringList StatusParts::summary() const
{
    return keys(m_presentation.summary);
}

QStringList StatusParts::menuLine() const
{
    return keys(m_presentation.menuLine);
}

QStringList StatusParts::accessible() const
{
    return keys(m_presentation.accessible);
}

QString StatusParts::mark() const
{
    return statusMarkKey(m_presentation.mark);
}

bool StatusParts::showsSession() const
{
    return m_showsSession;
}

void StatusParts::watch()
{
    for (const QMetaObject::Connection &connection : std::as_const(m_watches)) {
        disconnect(connection);
    }
    m_watches.clear();
    if (m_timer) {
        for (auto signal : {&TimerModel::statusChanged, &TimerModel::currentEntryChanged, &TimerModel::chainChanged, &TimerModel::sessionActiveChanged}) {
            m_watches.append(connect(m_timer, signal, this, &StatusParts::update));
        }
        m_watches.append(connect(m_timer, &QObject::destroyed, this, &StatusParts::update));
    }
    if (m_session) {
        for (auto signal : {&PomodoroSession::modeChanged, &PomodoroSession::sessionChanged}) {
            m_watches.append(connect(m_session, signal, this, &StatusParts::update));
        }
        m_watches.append(connect(m_session, &QObject::destroyed, this, &StatusParts::update));
    }
}

void StatusParts::update()
{
    const StatusInput input = m_timer ? StatusInput::of(*m_timer, m_session, m_hasMessage) : StatusInput();
    const StatusPresentation presentation = m_timer ? StatusPresentation::of(input, StatusPolicy::plasma()) : StatusPresentation();
    if (presentation != m_presentation || input.showsSession != m_showsSession) {
        m_presentation = presentation;
        m_showsSession = input.showsSession;
        Q_EMIT changed();
    }
}

}
