#include "projectcatalog.h"

#include "connection.h"

#include <QRegularExpression>

#include <algorithm>
#include <utility>

namespace Tokkl
{

ProjectCatalog::ProjectCatalog(std::function<bool()> accepting, QObject *parent)
    : QObject(parent)
    , m_accepting(std::move(accepting))
{
}

const QList<Project> &ProjectCatalog::projects() const
{
    return m_projects;
}

bool ProjectCatalog::incomplete() const
{
    return m_incomplete;
}

bool ProjectCatalog::listKnown() const
{
    return m_listKnown;
}

std::optional<Project> ProjectCatalog::activeProject(qint64 id) const
{
    return findActive(m_projects, id);
}

std::optional<Project> ProjectCatalog::findActive(const QList<Project> &projects, qint64 id)
{
    const auto found = std::find_if(projects.cbegin(), projects.cend(), [id](const Project &candidate) {
        return candidate.id == id;
    });
    if (found == projects.cend() || !found->active) {
        return std::nullopt;
    }
    return *found;
}

std::optional<Project> ProjectCatalog::knownProject(qint64 id, bool *gone) const
{
    if (gone) {
        *gone = false;
    }
    for (const Project &project : m_projects) {
        if (project.id == id) {
            return project;
        }
    }
    if (m_lookedUp && m_lookedUp->id == id) {
        if (gone) {
            *gone = m_lookedUpGone;
        }
        return m_lookedUp;
    }
    return std::nullopt;
}

ProjectCatalog::Indicator ProjectCatalog::indicatorFor(std::optional<qint64> id) const
{
    Indicator indicator;
    if (!id) {
        return indicator;
    }
    bool gone = false;
    const std::optional<Project> project = knownProject(*id, &gone);
    if (!project) {
        indicator.state = Indicator::State::Pending;
    } else if (!gone) {
        indicator.state = Indicator::State::Project;
        // The rule of isHexColor in packages/common/colors.ts.
        static const QRegularExpression hex(QStringLiteral("^#[0-9a-f]{6}$"), QRegularExpression::CaseInsensitiveOption);
        if (hex.match(project->color).hasMatch()) {
            indicator.color = project->color.toLower();
        }
    }
    return indicator;
}

void ProjectCatalog::fetch(Connection *connection)
{
    if (m_listPending || !connection) {
        return;
    }
    m_listPending = true;
    connection->fetchProjects(m_epoch.guard(this, [this](const ApiResult<ProjectList> &result) {
        m_listPending = false;
        if (!m_accepting()) {
            return;
        }
        if (!result.ok()) {
            Q_EMIT readFailed(result.error);
            return;
        }
        m_projects = result.value->projects;
        m_incomplete = result.value->incomplete;
        m_listKnown = true;
        m_lookedUpStale = m_lookedUp.has_value();
        ++m_listRevision;
        Q_EMIT listChanged();
        Q_EMIT listLoaded();
    }));
}

bool ProjectCatalog::needsLookUp(qint64 id) const
{
    // Not among the active projects: read it once the active list is known,
    // so an archived project can still be named and a deleted one noticed.
    const bool listed = std::any_of(m_projects.cbegin(), m_projects.cend(), [id](const Project &project) {
        return project.id == id;
    });
    const bool stale = m_lookedUpStale && m_lookedUp && m_lookedUp->id == id;
    return !listed && (!knownProject(id) || stale) && m_listKnown && !m_lookupsPending.contains(id);
}

void ProjectCatalog::lookUp(Connection *connection, qint64 id, qint64 workspace, std::function<bool(qint64)> stillWanted)
{
    if (!connection) {
        return;
    }
    m_lookupsPending.insert(id);
    const quint64 revision = m_listRevision;
    connection->fetchProject(id, m_epoch.guard(this, [this, id, workspace, revision, stillWanted](const ApiResult<Project> &result) {
        m_lookupsPending.remove(id);
        if (!m_accepting() || !stillWanted(id)) {
            return;
        }
        // Asked before the latest list: show the answer for now and read the
        // project once more.
        const bool stale = revision != m_listRevision;
        if (result.ok()) {
            m_lookedUp = *result.value;
            m_lookedUpGone = false;
        } else if (result.error.kind == ApiError::Kind::Forbidden) {
            Q_EMIT readFailed(result.error);
            return;
        } else if (result.error.status == 404) {
            // Deleted since it was chosen: keep the id, without a name.
            Project gone;
            gone.id = id;
            gone.workspaceId = workspace;
            gone.active = false;
            m_lookedUp = gone;
            m_lookedUpGone = true;
        } else {
            return; // read again on the next resolve
        }
        m_lookedUpStale = stale;
        Q_EMIT projectResolved();
    }));
}

void ProjectCatalog::forget()
{
    m_lookedUp.reset();
    m_lookedUpGone = false;
    m_lookedUpStale = false;
    m_lookupsPending.clear();
    m_listKnown = false;
}

void ProjectCatalog::clearList()
{
    if (m_projects.isEmpty() && !m_incomplete) {
        return;
    }
    m_projects.clear();
    m_incomplete = false;
    Q_EMIT listChanged();
}

void ProjectCatalog::reset()
{
    m_epoch.advance();
    m_listPending = false;
    forget();
}

}
