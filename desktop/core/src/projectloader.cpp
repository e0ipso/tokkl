#include "projectloader.h"

#include "timermodel.h"

namespace Tokkl
{

ProjectLoader::ProjectLoader(const TimerModel *view, TimerCatalogUpdates *updates, QObject *parent)
    : QObject(parent)
    , m_view(view)
    , m_catalog(updates)
{
    m_catalog->onProjectsAnswered(this, [this] {
        resolveChosenProject();
    });
    // A new next-start project may need its details read.
    connect(m_view, &TimerModel::selectionChanged, this, &ProjectLoader::resolveChosenProject);
}

void ProjectLoader::fetchProjects()
{
    if (m_catalog->readable()) {
        m_catalog->readProjects();
    }
}

void ProjectLoader::resolveChosenProject()
{
    const std::optional<qint64> id = m_view->chosenProject();
    if (id && m_catalog->readable()) {
        m_catalog->lookUpProject(*id, [this](qint64 projectId) {
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
    if (!m_view->isSessionActive() && m_catalog->takeLastEntryWanted() && !m_view->isRunning() && m_catalog->readable()) {
        m_catalog->readLastEntry([this] {
            return !m_view->workspaceAccessLost() && !m_view->isRunning();
        });
    }
}

}
