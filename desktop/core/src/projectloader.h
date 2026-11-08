#pragma once

#include <QObject>

#include <functional>
#include <optional>

namespace Tokkl
{

class Connection;
class ProjectCatalog;
class TimerModel;
class TimerModelUpdates;

// The timer's reads for what it shows of projects: the workspace's project
// list, a chosen project the list lacks, and the last entry's project for
// the next start. TimerModel starts none of them; TimerCoordinator owns the
// loader, which decides when to read and lets the answers land in the
// model's ProjectCatalog and NextStartSelection, which tell the model.
//
// A chosen project is resolved whenever the next start's choice changes, a
// list or a single project's answer arrives, and after every state the
// coordinator shows: when the list, once known, lacks it, it is read on its
// own, and the model then shows the chosen project as the catalog knows it.
class ProjectLoader : public QObject
{
    Q_OBJECT

public:
    // The view and the updates are the same model, not owned; it must
    // outlive the loader.
    ProjectLoader(const TimerModel *view, TimerModelUpdates *updates, QObject *parent = nullptr);

    // Reads the workspace's projects, when the workspace can be read.
    void fetchProjects();
    // Reads the chosen project when the list lacks it and the workspace can
    // be read, then has the model show it.
    void resolveChosenProject();
    // After a state: when the last entry was asked for, reads its project
    // for the next start, unless a session is active, an entry runs or the
    // workspace cannot be read. The answer applies only while the workspace
    // is kept and nothing runs.
    void readLastEntryIfWanted();

    // Reads project id of workspace into the catalog on its own when the
    // catalog says it needs to; see ProjectCatalog::needsLookUp(). The
    // answer counts while stillWanted(id) is true.
    static void lookUp(ProjectCatalog &catalog, Connection *connection, qint64 id, qint64 workspace, std::function<bool(qint64)> stillWanted);

private:
    const TimerModel *m_view;
    TimerModelUpdates *m_updates;
};

}
