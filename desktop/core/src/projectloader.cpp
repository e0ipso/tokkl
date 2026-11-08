#include "projectloader.h"

#include "projectcatalog.h"
#include "timermodel.h"

#include <utility>

namespace Tokkl
{

ProjectLoader::ProjectLoader(const TimerModel *view, TimerModelUpdates *updates, QObject *parent)
    : QObject(parent)
    , m_view(view)
    , m_updates(updates)
{
    // After the model's own handlers of the same signals, which apply a
    // next-start default that waited for the list.
    ProjectCatalog &catalog = m_updates->catalog();
    connect(&catalog, &ProjectCatalog::listLoaded, this, &ProjectLoader::resolveChosenProject);
    connect(&catalog, &ProjectCatalog::projectResolved, this, &ProjectLoader::resolveChosenProject);
    // A new next-start project may need its details read.
    connect(m_view, &TimerModel::selectionChanged, this, &ProjectLoader::resolveChosenProject);
}

void ProjectLoader::fetchProjects()
{
    if (m_updates->readable()) {
        m_updates->catalog().fetch(m_view->connection());
    }
}

void ProjectLoader::resolveChosenProject()
{
    const std::optional<qint64> id = m_view->chosenProject();
    if (id && m_updates->readable()) {
        lookUp(m_updates->catalog(), m_view->connection(), *id, m_view->workspaceId(), [this](qint64 projectId) {
            return m_view->chosenProject() == projectId;
        });
    }
    // After the read is on its way, so the indicator shows it pending.
    m_updates->showChosenProject();
}

void ProjectLoader::readLastEntryIfWanted()
{
    // The first state of a connection. A running entry sets the default
    // when it stops; otherwise ask for the last one.
    NextStartSelection &selection = m_updates->selection();
    if (!m_view->isSessionActive() && selection.takeLastEntryWanted() && !m_view->isRunning() && m_updates->readable()) {
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
