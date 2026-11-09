#pragma once

#include <QObject>

#include <functional>

namespace Tokkl
{

class ChosenProject;
class NextStartSelection;
class ProjectCatalog;
class TimerModel;

// The reads ProjectLoader may start, each landing in a TimerModel, which
// tells the panels of what changed: the workspace's projects, a project
// read on its own, and the last entry's project for the next start. The
// loader decides when; it never holds the catalog or the selection.
class TimerCatalogUpdates
{
public:
    virtual ~TimerCatalogUpdates() = default;

    // The connection may read the workspace now.
    virtual bool readable() const = 0;
    // Reads the workspace's projects through the connection, unless a read
    // is on its way; see ProjectCatalog::fetch().
    virtual void readProjects() = 0;
    // Reads project id of the workspace on its own when the list, once
    // known, lacks it and its own read is missing, out of date and not on
    // its way. The answer counts while stillWanted(id) is true.
    virtual void lookUpProject(qint64 id, std::function<bool(qint64)> stillWanted) = 0;
    // True once after the last entry's project was asked for.
    virtual bool takeLastEntryWanted() = 0;
    // Reads the account's newest entry for the next start's default; see
    // NextStartSelection::readLastEntry().
    virtual void readLastEntry(std::function<bool()> stillWanted) = 0;
    // Calls answered, with context, after each project list and each
    // single-project answer the model has taken in.
    virtual void onProjectsAnswered(QObject *context, std::function<void()> answered) = 0;
    // Shows the chosen project and the indicator as the catalog knows them.
    virtual void showChosenProject() = 0;
};

// The catalog role of one TimerModel, over the ProjectCatalog,
// NextStartSelection and ChosenProject the model owns. It takes the
// connection, the workspace and the chosen project from the model's public
// view, and sends no notification of its own: the model announces what the
// catalog, the selection and the chosen project change.
class ProjectCatalogAdapter final : public TimerCatalogUpdates
{
public:
    // None is owned; the view owns the others and must outlive the adapter.
    ProjectCatalogAdapter(const TimerModel *view, ProjectCatalog *catalog, NextStartSelection *next, ChosenProject *chosen);

    bool readable() const override;
    void readProjects() override;
    void lookUpProject(qint64 id, std::function<bool(qint64)> stillWanted) override;
    bool takeLastEntryWanted() override;
    void readLastEntry(std::function<bool()> stillWanted) override;
    void onProjectsAnswered(QObject *context, std::function<void()> answered) override;
    void showChosenProject() override;

private:
    const TimerModel *m_view;
    ProjectCatalog *m_catalog;
    NextStartSelection *m_next;
    ChosenProject *m_chosen;
};

}
