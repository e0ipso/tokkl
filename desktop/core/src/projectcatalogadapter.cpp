#include "projectcatalogadapter.h"

#include "chosenproject.h"
#include "connection.h"
#include "nextstartselection.h"
#include "projectcatalog.h"
#include "timermodel.h"

#include <utility>

namespace Tokkl
{

ProjectCatalogAdapter::ProjectCatalogAdapter(const TimerModel *view, ProjectCatalog *catalog, NextStartSelection *next, ChosenProject *chosen)
    : m_view(view)
    , m_catalog(catalog)
    , m_next(next)
    , m_chosen(chosen)
{
}

bool ProjectCatalogAdapter::readable() const
{
    const Connection *connection = m_view->connection();
    return connection && connection->isConnected() && !m_view->workspaceAccessLost() && !connection->rateLimitedUntil().isValid();
}

void ProjectCatalogAdapter::readProjects()
{
    m_catalog->fetch(m_view->connection());
}

void ProjectCatalogAdapter::lookUpProject(qint64 id, std::function<bool(qint64)> stillWanted)
{
    Connection *connection = m_view->connection();
    if (connection && m_catalog->needsLookUp(id)) {
        m_catalog->lookUp(connection, id, m_view->workspaceId(), std::move(stillWanted));
    }
}

bool ProjectCatalogAdapter::takeLastEntryWanted()
{
    return m_next->takeLastEntryWanted();
}

void ProjectCatalogAdapter::readLastEntry(std::function<bool()> stillWanted)
{
    m_next->readLastEntry(std::move(stillWanted));
}

void ProjectCatalogAdapter::onProjectsAnswered(QObject *context, std::function<void()> answered)
{
    // After the model's own handlers of the same signals, connected when it
    // was built, which apply a next-start default that waited for the list.
    QObject::connect(m_catalog, &ProjectCatalog::listLoaded, context, answered);
    QObject::connect(m_catalog, &ProjectCatalog::projectResolved, context, answered);
}

void ProjectCatalogAdapter::showChosenProject()
{
    m_chosen->show(m_view->chosenProject(), m_view->isRunning() || m_view->isPaused());
}

}
