#pragma once

#include "projectcatalog.h"

#include <QObject>

namespace Tokkl
{

class TimerCatalogUpdates;
class TimerModel;

// The timer's reads for what it shows of projects: the workspace's project
// list, a chosen project the list lacks, and the last entry's project for
// the next start. TimerModel starts none of them; TimerCoordinator owns the
// loader, which decides when to read and starts each read through the
// model's TimerCatalogUpdates role; the answers land in the model.
//
// A chosen project is resolved whenever the next start's choice changes, a
// list or a single project's answer arrives, and after every state the
// coordinator shows: when the list, once known, lacks it, it is read on its
// own, and the model then shows the chosen project as the catalog knows it.
class ProjectLoader : public QObject
{
    Q_OBJECT

public:
    // The view and the catalog are the same model's, not owned; it must
    // outlive the loader. The loader sees no other role of the model.
    ProjectLoader(const TimerModel *view, TimerCatalogUpdates *catalog, QObject *parent = nullptr);

    // Reads the workspace's projects when the workspace can be read and the
    // list changed since the last read.
    void fetchProjects();
    // Reads the chosen project when the list lacks it and the workspace can
    // be read, then has the model show it.
    void resolveChosenProject();
    // After a state: when the last entry was asked for, reads its project
    // for the next start, unless a session is active, an entry runs or the
    // workspace cannot be read. The answer applies only while the workspace
    // is kept and nothing runs.
    void readLastEntryIfWanted();

private:
    const TimerModel *m_view;
    TimerCatalogUpdates *m_catalog;
};

}
