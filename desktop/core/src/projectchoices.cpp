#include "projectchoices.h"

#include <QVariantMap>

namespace Tokkl
{

ProjectLabelParts ProjectLabelParts::of(const Project &project)
{
    ProjectLabelParts parts;
    parts.missing = project.name.isEmpty();
    parts.kind = parts.missing ? Kind::Unavailable : Kind::Named;
    if (!parts.missing) {
        parts.name = project.name;
        parts.client = project.clientName;
        parts.archived = !project.active;
    }
    return parts;
}

ProjectLabelParts ProjectLabelParts::unknown()
{
    ProjectLabelParts parts;
    parts.kind = Kind::Unknown;
    return parts;
}

QString ProjectLabelParts::kindKey(Kind kind)
{
    switch (kind) {
    case Kind::None:
        break;
    case Kind::Unknown:
        return QStringLiteral("unknown");
    case Kind::Unavailable:
        return QStringLiteral("unavailable");
    case Kind::Named:
        return QStringLiteral("named");
    }
    return QStringLiteral("none");
}

QVariantMap ProjectLabelParts::toVariantMap() const
{
    return {
        {QStringLiteral("name"), name},
        {QStringLiteral("client"), client},
        {QStringLiteral("archived"), archived},
        {QStringLiteral("missing"), missing},
        {QStringLiteral("kind"), kindKey(kind)},
    };
}

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
        const bool note = row.kind == Row::Kind::Incomplete;
        list.append(QVariantMap{
            {QStringLiteral("kind"), kind},
            {QStringLiteral("project"), note ? QVariantMap() : row.project.toVariantMap()},
            {QStringLiteral("label"), note ? QVariantMap() : ProjectLabelParts::of(row.project).toVariantMap()},
        });
    }
    return list;
}

}
