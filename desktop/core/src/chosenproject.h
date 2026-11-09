#pragma once

#include "apitypes.h"
#include "projectcatalog.h"

#include <QObject>

#include <optional>

namespace Tokkl
{

// What the menu and the panel indicator show of the chosen project: the
// project of the running or paused entry, or of the next start, as the
// catalog knows it. It reads nothing: the timer reads a chosen project
// the catalog lacks. Until a newer read answers, the indicator keeps what
// the last one found.
class ChosenProject : public QObject
{
    Q_OBJECT

public:
    // The catalog is not owned and must outlive this object.
    explicit ChosenProject(const ProjectCatalog *catalog, QObject *parent = nullptr);

    // The running or paused entry's project, also when it is archived;
    // nullopt without one or while unresolved.
    const std::optional<Project> &entryProject() const;
    const ProjectCatalog::Indicator &indicator() const;
    // The project the menu names for id: entryProject() when ofEntry and it
    // is that project, otherwise the listed project with that id.
    std::optional<Project> details(std::optional<qint64> id, bool ofEntry) const;

    // Follows the chosen project id; ofEntry when it is the running or
    // paused entry's.
    void show(std::optional<qint64> id, bool ofEntry);

Q_SIGNALS:
    void entryProjectChanged();
    void indicatorChanged();

private:
    const ProjectCatalog *m_catalog;
    std::optional<Project> m_entryProject;
    ProjectCatalog::Indicator m_indicator;
};

}
