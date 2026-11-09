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

NextStartSelection::Choice NextStartSelection::fromLatestEntry(const std::optional<ListedEntry> &latest, qint64 workspaceId)
{
    if (!latest || latest->entry.workspaceId != workspaceId || !latest->entry.projectId || !latest->projectActive) {
        return Choice();
    }
    return Choice{latest->entry.projectId, latest->projectBillable};
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

std::optional<NextStartSelection::Choice> NextStartSelection::choiceFor(const QVariant &projectId) const
{
    return forProject(projectId, m_catalog->projects());
}

NextStartSelection::Choice NextStartSelection::choice() const
{
    return m_choice;
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

void NextStartSelection::readLastEntry(std::function<bool()> stillWanted)
{
    if (m_defaults.picked() || !m_connection) {
        return;
    }
    const quint64 number = m_defaults.beginLastEntryRead();
    m_connection->fetchLatestEntry(m_epoch.guard(this, [this, number, stillWanted](const ApiResult<std::optional<ListedEntry>> &result) {
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
        apply(fromLatestEntry(*result.value, m_connection ? m_connection->workspaceId() : 0));
    }));
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
