#include "nextstartselection.h"

#include "connection.h"
#include "projectcatalog.h"

#include <utility>

namespace Tokkl
{

namespace
{
using Choice = NextStartSelection::Choice;

Choice afterStop(std::optional<qint64> projectId, const QList<Project> &projects)
{
    const std::optional<Project> found = projectId ? ProjectCatalog::findActive(projects, *projectId) : std::nullopt;
    return found ? Choice{found->id, found->billable} : Choice();
}

Choice fromLatestEntry(const std::optional<ListedEntry> &latest, qint64 workspaceId)
{
    if (!latest || latest->entry.workspaceId != workspaceId || !latest->entry.projectId || !latest->projectActive) {
        return Choice();
    }
    return Choice{latest->entry.projectId, latest->projectBillable};
}
}

NextStartSelection::NextStartSelection(const ProjectCatalog *catalog, Connection &connection, QObject *parent)
    : QObject(parent)
    , m_catalog(catalog)
    , m_connection(connection)
{
}

std::optional<Choice> NextStartSelection::choiceFor(const QVariant &projectId) const
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
    const std::optional<Project> found = ProjectCatalog::findActive(m_catalog->projects(), id);
    if (!found) {
        return std::nullopt;
    }
    return Choice{id, found->billable};
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

void NextStartSelection::clear()
{
    m_picked = false;
    m_stopDefault.reset();
    m_lastEntryRead = 0;
}

void NextStartSelection::pick(const Choice &choice)
{
    clear();
    m_picked = true;
    apply(choice);
}

void NextStartSelection::pickBillable(bool billable)
{
    clear();
    m_picked = true;
    set(Choice{m_choice.projectId, billable});
}

void NextStartSelection::started()
{
    clear();
}

void NextStartSelection::entryRunning()
{
    m_lastEntryRead = 0;
}

void NextStartSelection::stopped(std::optional<qint64> projectId)
{
    // A pick made before this stop no longer applies.
    m_picked = false;
    m_stopDefault.reset();
    if (projectId && !m_catalog->listKnown()) {
        m_stopDefault = projectId;
    } else {
        apply(afterStop(projectId, m_catalog->projects()));
    }
}

void NextStartSelection::listLoaded()
{
    // Cleared by a pick, a start or a newer default since the stop.
    if (const std::optional<qint64> projectId = std::exchange(m_stopDefault, std::nullopt)) {
        apply(afterStop(projectId, m_catalog->projects()));
    }
}

void NextStartSelection::forget()
{
    clear();
    apply(Choice());
}

void NextStartSelection::reset()
{
    m_epoch.advance();
    clear();
    m_lastEntryWanted = true;
    set(Choice());
}

void NextStartSelection::wantLastEntry()
{
    m_lastEntryWanted = true;
}

bool NextStartSelection::takeLastEntryWanted()
{
    return std::exchange(m_lastEntryWanted, false);
}

void NextStartSelection::readLastEntry(std::function<bool()> stillWanted)
{
    if (m_picked) {
        return;
    }
    const quint64 number = m_lastEntryRead = ++m_lastEntryReads;
    m_connection.fetchLatestEntry(m_epoch.guard(this, [this, number, stillWanted](const ApiResult<std::optional<ListedEntry>> &result) {
        if (m_lastEntryRead != number) {
            return; // a choice or start since it was sent
        }
        m_lastEntryRead = 0;
        if (m_picked || !stillWanted()) {
            return;
        }
        if (!result.ok()) {
            m_lastEntryWanted = true;
            return;
        }
        m_stopDefault.reset();
        apply(fromLatestEntry(*result.value, m_connection.workspaceId()));
    }));
}

void NextStartSelection::apply(const Choice &choice)
{
    // A last-entry read still in flight is older than this choice.
    m_lastEntryRead = 0;
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
