#pragma once

#include "apitypes.h"

#include <QList>
#include <QVariantList>

#include <optional>

namespace Tokkl
{

// Only a Named label has a name, a client or the archived flag.
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
    // Always kind == Unavailable.
    bool missing = false;
    Kind kind = Kind::None;

    // An empty name reads as Unavailable: that is how the catalog keeps a
    // project the instance no longer has.
    static ProjectLabelParts of(const Project &project);
    static ProjectLabelParts unknown();
    // "none", "unknown", "unavailable" or "named".
    static QString kindKey(Kind kind);
    QVariantMap toVariantMap() const;

    bool operator==(const ProjectLabelParts &other) const = default;
};

// The cut-short note goes before the projects so a long list does not bury
// it. A held archived project is checked but never offered.
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
        // Never for Archived or Incomplete.
        bool enabled = false;

        bool operator==(const Row &other) const = default;
    };

    // As TimerController::chooseProject() requires.
    bool choosable = false;
    bool noProjectChecked = false;
    QList<Row> rows;

    // heldProject is the running or paused entry's project when known.
    static ProjectChoices build(const QList<Project> &projects,
                                bool incomplete,
                                std::optional<qint64> chosen,
                                const std::optional<Project> &heldProject,
                                bool choosable);

    bool incomplete() const;
    // Leaves out checked and enabled, so an open menu keeps its items while the
    // choice changes.
    QVariantList toVariantList() const;

    bool operator==(const ProjectChoices &other) const = default;
};

}
