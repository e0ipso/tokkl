#include "projectloader.h"

#include "projectcatalog.h"
#include "timermodel.h"

#include <utility>

namespace Tokkl
{

ProjectLoader::ProjectLoader(const TimerModel *view, TimerCatalogUpdates *updates, QObject *parent)
    : QObject(parent)
    , m_view(view)
    , m_catalog(updates)
{
    // After the model's own handlers of the same signals, which apply a
    // next-start default that waited for the list.
    ProjectCatalog &projects = m_catalog->catalog();
    connect(&projects, &ProjectCatalog::listLoaded, this, &ProjectLoader::resolveChosenProject);
    connect(&projects, &ProjectCatalog::projectResolved, this, &ProjectLoader::resolveChosenProject);
    // A new next-start project may need its details read.
    connect(m_view, &TimerModel::selectionChanged, this, &ProjectLoader::resolveChosenProject);
}

void ProjectLoader::fetchProjects()
{
    if (m_catalog->readable()) {
        m_catalog->catalog().fetch(m_view->connection());
    }
}

void ProjectLoader::resolveChosenProject()
{
    const std::optional<qint64> id = m_view->chosenProject();
    if (id && m_catalog->readable()) {
        lookUp(m_catalog->catalog(), m_view->connection(), *id, m_view->workspaceId(), [this](qint64 projectId) {
            return m_view->chosenProject() == projectId;
        });
    }
    // After the read is on its way, so the indicator shows it pending.
    m_catalog->showChosenProject();
}

void ProjectLoader::readLastEntryIfWanted()
{
    // The first state of a connection. A running entry sets the default
    // when it stops; otherwise ask for the last one.
    NextStartSelection &selection = m_catalog->selection();
    if (!m_view->isSessionActive() && selection.takeLastEntryWanted() && !m_view->isRunning() && m_catalog->readable()) {
        selection.readLastEntry([this] {
            return !m_view->workspaceAccessLost() && !m_view->isRunning();
        });
    }
}

void ProjectLoader::lookUp(ProjectCatalog &catalog, Connection *connection, qint64 id, qint64 workspace, std::function<bool(qint64)> stillWanted)
{
    if (connection && catalog.needsLookUp(id)) {
        catalog.lookUp(connection, id, workspace, std::move(stillWanted));
    }
}

}
