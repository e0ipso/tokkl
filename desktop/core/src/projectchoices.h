#pragma once

#include "apitypes.h"

#include <QList>
#include <QVariantList>

#include <optional>

namespace Tokkl
{

// What every panel words a project's label from, each with its own words.
// kind says which words: No project, Unknown project, Unavailable project,
// or for Named the name, then the client in parentheses, then that the
// project is archived. Only a Named label has a name, a client or the
// archived flag.
struct ProjectLabelParts {
    enum class Kind {
        None, // no project
        Unknown, // a project whose details are still being read
        Unavailable, // the instance no longer has it
        Named,
    };

    QString name;
    QString client;
    bool archived = false;
    // The instance no longer has the project: kind is Unavailable.
    bool missing = false;
    Kind kind = Kind::None;

    // Named, or Unavailable for a project with an empty name, which is how
    // the catalog keeps one the instance no longer has.
    static ProjectLabelParts of(const Project &project);
    static ProjectLabelParts unknown();
    // kind as the key the variant map carries: "none", "unknown",
    // "unavailable" or "named".
    static QString kindKey(Kind kind);
    // name, client, archived, missing and kind, for QML and the D-Bus
    // service.
    QVariantMap toVariantMap() const;

    bool operator==(const ProjectLabelParts &other) const = default;
};

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
    // "project"), project (a project map; empty for the note) and label
    // (ProjectLabelParts::toVariantMap(); empty for the note). Whether a
    // row is checked or enabled is left out, so the list changes only with
    // the projects and the held entry's project, and a menu that is open
    // keeps its items while the choice changes.
    QVariantList toVariantList() const;

    bool operator==(const ProjectChoices &other) const = default;
};

}
