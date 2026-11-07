#pragma once

#include "apitypes.h"

#include <QList>
#include <QVariantList>

#include <optional>

namespace Tokkl
{

// The project submenu of every desktop panel, as rows each platform puts in
// its own menu with its own words. The menu starts with No project, then
// has the rows: the running or paused entry's project when it is archived
// (checked and never offered), a note when the list is cut short, then the
// active projects, the chosen one checked. The note comes before the
// projects so a long list does not bury it.
struct ProjectChoices {
    struct Row {
        enum class Kind {
            Archived, // the running or paused entry's archived project
            Incomplete, // the workspace has more active projects than these
            Project, // an active project
        };

        Kind kind = Kind::Project;
        Project project; // empty for Incomplete
        bool checked = false;
        // A choice the menu offers now. Never for Archived or Incomplete.
        bool enabled = false;

        bool operator==(const Row &other) const = default;
    };

    // A project can be chosen now: the timer can write, nothing runs and no
    // chain is paused, as TimerController::chooseProject() requires.
    bool choosable = false;
    bool noProjectChecked = false;
    QList<Row> rows;

    // projects is the workspace's active projects, incomplete says the list
    // is cut short, chosen is the project shown (null for none), and
    // heldProject the running or paused entry's project when one is held
    // and known.
    static ProjectChoices build(const QList<Project> &projects,
                                bool incomplete,
                                std::optional<qint64> chosen,
                                const std::optional<Project> &heldProject,
                                bool choosable);

    bool incomplete() const;
    // The rows for QML: maps with kind ("archived", "incomplete" or
    // "project") and project (a project map; empty for the note). Whether a
    // row is checked or enabled is left out, so the list changes only with
    // the projects and the held entry's project, and a menu that is open
    // keeps its items while the choice changes.
    QVariantList toVariantList() const;

    bool operator==(const ProjectChoices &other) const = default;
};

}
