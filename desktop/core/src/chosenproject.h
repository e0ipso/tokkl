#pragma once

#include "apitypes.h"
#include "projectcatalog.h"

#include <QObject>

#include <functional>
#include <optional>

namespace Tokkl
{

class Connection;

// What the menu and the panel indicator show of the chosen project: the
// project of the running or paused entry, or of the next start.
//
// A chosen project the catalog lacks is read on its own once the active
// list is known. Until a newer read answers, the indicator keeps what the
// last one found.
class ChosenProject : public QObject
{
    Q_OBJECT

public:
    // The catalog is not owned and must outlive this object. chosen() names
    // the project chosen now; a read that answers for another one is
    // dropped.
    ChosenProject(ProjectCatalog *catalog, std::function<std::optional<qint64>()> chosen, QObject *parent = nullptr);

    // The running or paused entry's project, also when it is archived;
    // nullopt without one or while unresolved.
    const std::optional<Project> &entryProject() const;
    const ProjectCatalog::Indicator &indicator() const;
    // The project the menu names for id: entryProject() when ofEntry and it
    // is that project, otherwise the listed project with that id.
    std::optional<Project> details(std::optional<qint64> id, bool ofEntry) const;

    // Follows the chosen project id; ofEntry when it is the running or
    // paused entry's. With readVia, a project the catalog lacks is read
    // through it from workspaceId.
    void update(std::optional<qint64> id, bool ofEntry, Connection *readVia, qint64 workspaceId);

Q_SIGNALS:
    void entryProjectChanged();
    void indicatorChanged();

private:
    ProjectCatalog *m_catalog;
    std::function<std::optional<qint64>()> m_chosen;
    std::optional<Project> m_entryProject;
    ProjectCatalog::Indicator m_indicator;
};

}
