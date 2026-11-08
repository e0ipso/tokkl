#include "nextstartselection.h"

#include "connection.h"
#include "projectcatalog.h"

#include <utility>

namespace Tokkl
{

std::optional<NextStartSelection::Choice> NextStartSelection::forProject(const QVariant &projectId, const QList<Project> &projects)
{
    if (projectId.isNull() || !projectId.isValid()) {
        return Choice();
    }
    bool ok = false;
    const qint64 id = projectId.toLongLong(&ok);
    if (!ok || id < 0) {
        return std::nullopt;
    }
    if (id == 0) {
        return Choice();
    }
    // Only an active project of this workspace is a choice; an archived one
    // stays on its entry until another is chosen.
    const std::optional<Project> found = ProjectCatalog::findActive(projects, id);
    if (!found) {
        return std::nullopt;
    }
    return Choice{id, found->billable};
}

NextStartSelection::Choice NextStartSelection::afterStop(std::optional<qint64> projectId, const QList<Project> &projects)
{
    const std::optional<Project> found = projectId ? ProjectCatalog::findActive(projects, *projectId) : std::nullopt;
    return found ? Choice{found->id, found->billable} : Choice();
}

NextStartSelection::Choice NextStartSelection::fromRecentEntries(const QList<ListedEntry> &entries, qint64 workspaceId)
{
    if (entries.isEmpty()) {
        return Choice();
    }
    const ListedEntry &last = entries.first();
    if (last.entry.workspaceId != workspaceId || !last.entry.projectId || !last.projectActive) {
        return Choice();
    }
    return Choice{last.entry.projectId, last.projectBillable};
}

NextStartSelection::NextStartSelection(const ProjectCatalog *catalog, QObject *parent)
    : QObject(parent)
    , m_catalog(catalog)
{
}

void NextStartSelection::setConnection(Connection *connection)
{
    m_connection = connection;
    set(Choice());
}

std::optional<qint64> NextStartSelection::projectId() const
{
    return m_choice.projectId;
}

QVariant NextStartSelection::projectIdVariant() const
{
    return m_choice.projectId ? QVariant(*m_choice.projectId) : QVariant::fromValue(nullptr);
}

bool NextStartSelection::billable() const
{
    return m_choice.billable;
}

void NextStartSelection::pick(const Choice &choice)
{
    m_defaults.pick();
    apply(choice);
}

void NextStartSelection::pickBillable(bool billable)
{
    if (m_connection) {
        m_defaults.pick();
        set(Choice{m_choice.projectId, billable});
    }
}

void NextStartSelection::started()
{
    m_defaults.clear();
}

void NextStartSelection::entryRunning()
{
    m_defaults.cancelLastEntryRead();
}

void NextStartSelection::stopped(std::optional<qint64> projectId)
{
    // A pick made before this stop no longer applies.
    m_defaults.stopped();
    if (projectId && !m_catalog->listKnown()) {
        m_defaults.waitForList(*projectId);
    } else {
        apply(afterStop(projectId, m_catalog->projects()));
    }
}

void NextStartSelection::listLoaded()
{
    // Cleared by a pick, a start or a newer default since the stop.
    if (const std::optional<qint64> projectId = m_defaults.takeStopDefault()) {
        apply(afterStop(projectId, m_catalog->projects()));
    }
}

void NextStartSelection::forget()
{
    m_defaults.clear();
    apply(Choice());
}

void NextStartSelection::reset()
{
    m_epoch.advance();
    m_defaults.reset();
    set(Choice());
}

void NextStartSelection::wantLastEntry()
{
    m_defaults.wantLastEntry();
}

bool NextStartSelection::takeLastEntryWanted()
{
    return m_defaults.takeLastEntryWanted();
}

void NextStartSelection::readLastEntry(std::function<bool()> stillWanted, const QDateTime &now)
{
    if (m_defaults.picked() || !m_connection) {
        return;
    }
    readEntries(m_defaults.beginLastEntryRead(), now, std::move(stillWanted));
}

void NextStartSelection::readEntries(quint64 number, const QDateTime &now, std::function<bool()> stillWanted)
{
    if (!m_connection) {
        return;
    }
    auto answered = [this, number, now, stillWanted](const ApiResult<QList<ListedEntry>> &result) {
        // Nothing in the first days: the wider read, while it may still
        // apply.
        if (now.isValid() && result.ok() && result.value->isEmpty() && m_defaults.lastEntryReadIs(number) && !m_defaults.picked() && stillWanted()) {
            readEntries(number, QDateTime(), stillWanted);
            return;
        }
        if (!m_defaults.takeLastEntryRead(number)) {
            return; // a choice or start since it was sent
        }
        if (m_defaults.picked() || !stillWanted()) {
            return;
        }
        if (!result.ok()) {
            // Try again after the next state.
            m_defaults.wantLastEntry();
            return;
        }
        m_defaults.takeStopDefault();
        apply(fromRecentEntries(*result.value, m_connection ? m_connection->workspaceId() : 0));
    };
    if (now.isValid()) {
        // Up to a day ahead, for a server clock a little ahead of the state's.
        m_connection->fetchEntriesStarted(now.addDays(-lastEntryFirstDays), now.addDays(1), m_epoch.guard(this, std::move(answered)));
    } else {
        // Known limit: the API lists only the entries of the last 9 days, so
        // after a longer break there is no last entry and the next start has
        // no project.
        m_connection->fetchRecentEntries(m_epoch.guard(this, std::move(answered)));
    }
}

void NextStartSelection::apply(const Choice &choice)
{
    if (!m_connection) {
        return;
    }
    // A last-entry read still in flight is older than this choice.
    m_defaults.cancelLastEntryRead();
    set(choice);
}

void NextStartSelection::set(const Choice &choice)
{
    if (choice == m_choice) {
        return;
    }
    m_choice = choice;
    Q_EMIT changed();
}

}
