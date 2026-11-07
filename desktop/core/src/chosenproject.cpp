#include "chosenproject.h"

#include <utility>

namespace Tokkl
{

ChosenProject::ChosenProject(ProjectCatalog *catalog, std::function<std::optional<qint64>()> chosen, QObject *parent)
    : QObject(parent)
    , m_catalog(catalog)
    , m_chosen(std::move(chosen))
{
}

const std::optional<Project> &ChosenProject::entryProject() const
{
    return m_entryProject;
}

const ProjectCatalog::Indicator &ChosenProject::indicator() const
{
    return m_indicator;
}

std::optional<Project> ChosenProject::details(std::optional<qint64> id, bool ofEntry) const
{
    if (!id) {
        return std::nullopt;
    }
    if (ofEntry && m_entryProject && m_entryProject->id == *id) {
        return m_entryProject;
    }
    for (const Project &project : m_catalog->projects()) {
        if (project.id == *id) {
            return project;
        }
    }
    return std::nullopt;
}

void ChosenProject::update(std::optional<qint64> id, bool ofEntry, Connection *readVia, qint64 workspaceId)
{
    if (id && readVia && m_catalog->needsLookUp(*id)) {
        m_catalog->lookUp(readVia, *id, workspaceId, [this](qint64 projectId) {
            return m_chosen() == projectId;
        });
    }
    const std::optional<Project> entryProject = id && ofEntry ? m_catalog->knownProject(*id) : std::nullopt;
    if (entryProject != m_entryProject) {
        m_entryProject = entryProject;
        Q_EMIT entryProjectChanged();
    }
    const ProjectCatalog::Indicator indicator = m_catalog->indicatorFor(id);
    if (indicator != m_indicator) {
        m_indicator = indicator;
        Q_EMIT indicatorChanged();
    }
}

}
