#include "projectchoices.h"

#include <QVariantMap>

namespace Tokkl
{

ProjectChoices ProjectChoices::build(const QList<Project> &projects,
                                     bool incomplete,
                                     std::optional<qint64> chosen,
                                     const std::optional<Project> &heldProject,
                                     bool choosable)
{
    ProjectChoices choices;
    choices.choosable = choosable;
    choices.noProjectChecked = !chosen.has_value();
    // Shown so the menu can name it, but never offered for new work.
    if (heldProject && !heldProject->active) {
        choices.rows.append(Row{Row::Kind::Archived, *heldProject, true, false});
    }
    if (incomplete) {
        choices.rows.append(Row{Row::Kind::Incomplete, Project(), false, false});
    }
    for (const Project &project : projects) {
        choices.rows.append(Row{Row::Kind::Project, project, chosen == project.id, choosable});
    }
    return choices;
}

bool ProjectChoices::incomplete() const
{
    for (const Row &row : rows) {
        if (row.kind == Row::Kind::Incomplete) {
            return true;
        }
    }
    return false;
}

QVariantList ProjectChoices::toVariantList() const
{
    QVariantList list;
    for (const Row &row : rows) {
        QString kind;
        switch (row.kind) {
        case Row::Kind::Archived:
            kind = QStringLiteral("archived");
            break;
        case Row::Kind::Incomplete:
            kind = QStringLiteral("incomplete");
            break;
        case Row::Kind::Project:
            kind = QStringLiteral("project");
            break;
        }
        list.append(QVariantMap{
            {QStringLiteral("kind"), kind},
            {QStringLiteral("project"), row.kind == Row::Kind::Incomplete ? QVariantMap() : row.project.toVariantMap()},
        });
    }
    return list;
}

}
