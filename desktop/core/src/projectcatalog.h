#pragma once

#include "apitypes.h"
#include "epoch.h"

#include <QObject>
#include <QSet>
#include <QString>

#include <functional>
#include <optional>

namespace Tokkl
{

class Connection;

// What the timer knows about the projects of the bound workspace: the
// active list, paged in by Connection::fetchProjects(), and the one project
// outside it that was read on its own, because a running or chosen entry
// names it (archived, or deleted since).
//
// The server numbers the workspace's catalog and changes the number with
// every write that changes the list. A read first asks for that number: the
// same number as the list held keeps the list, and anything else reads the
// whole list again. The number kept is the one read before that list, so a
// write that lands while the list is on its way shows on the next read.
//
// That single project is checked again after every newer list, since it may
// have been renamed, recoloured or deleted in between; until the new answer
// arrives the old one stays. A 404 is kept as a project without a name, and
// is provisional too: the server may reuse a deleted id. At most one read
// per id is in flight. A read sent before a newer list arrived shows its
// answer and is read once more.
//
// The owner decides when the catalog may read and whether an answer still
// counts: reads are sent only when the owner calls fetch() or lookUp(), and
// an answer is dropped while accepting() is false, after reset(), or when
// the catalog is gone.
class ProjectCatalog : public QObject
{
    Q_OBJECT

public:
    // How the panel indicator shows a project: its state, and its colour as
    // lowercase #rrggbb, empty unless the state is Project and the colour
    // is valid.
    struct Indicator {
        enum class State {
            None, // no project, or the instance no longer has it (404)
            Pending, // the project's details are still being read
            Project, // the project is known, archived or not
        };
        State state = State::None;
        QString color;

        bool operator==(const Indicator &other) const = default;
    };

    // accepting() is false while answers must be dropped, such as while the
    // workspace is refused.
    explicit ProjectCatalog(std::function<bool()> accepting, QObject *parent = nullptr);

    const QList<Project> &projects() const;
    // The list is a prefix of the workspace's active projects.
    bool incomplete() const;
    // A list has been read in this context.
    bool listKnown() const;
    // The active project with this id in projects, or nullopt.
    static std::optional<Project> findActive(const QList<Project> &projects, qint64 id);
    // The project from the list, else from its own read. gone is set when
    // that read answered 404.
    std::optional<Project> knownProject(qint64 id, bool *gone = nullptr) const;
    Indicator indicatorFor(std::optional<qint64> id) const;

    // Reads the catalog's number, then the list when the number is not the
    // one the list was read at. Does nothing while a read is on its way.
    // Emits listLoaded() with a new list, nothing when the list stays, or
    // readFailed().
    void fetch(Connection *connection);
    // True when id is missing from the list once it is known, and its own
    // read is missing, out of date, and not on its way.
    bool needsLookUp(qint64 id) const;
    // Reads one project of workspace. The answer counts only while
    // stillWanted(id) is true; it then emits projectResolved() for the
    // project or a 404, readFailed() for a 403, and nothing otherwise, so
    // the next lookUp() reads it again.
    void lookUp(Connection *connection, qint64 id, qint64 workspace, std::function<bool(qint64)> stillWanted);

    // Forgets the single-project reads and that a list was read. The list
    // itself stays until clearList().
    void forget();
    // Empties the list; emits listChanged() when it held anything.
    void clearList();
    // A new context: as forget(), and every answer on its way is dropped.
    void reset();

Q_SIGNALS:
    void listChanged();
    // A new list replaced the old one, after listChanged().
    void listLoaded();
    // A single-project read answered with the project or a 404.
    void projectResolved();
    // A read failed. A Forbidden error may mean the workspace was lost.
    void readFailed(const Tokkl::ApiError &error);

private:
    // Reads the whole list; revision is the catalog's number read just
    // before it.
    void fetchList(Connection *connection, qint64 revision);

    std::function<bool()> m_accepting;
    Epoch m_epoch;
    QList<Project> m_projects;
    bool m_incomplete = false;
    // The catalog's number the list was read at; none until a list is read
    // in this context.
    std::optional<qint64> m_revision;
    bool m_listPending = false;
    // Counts the lists read, so a single-project read can tell it predates
    // one.
    quint64 m_listsRead = 0;
    std::optional<Project> m_lookedUp;
    bool m_lookedUpGone = false;
    // A list was read after m_lookedUp, so it is read again.
    bool m_lookedUpStale = false;
    QSet<qint64> m_lookupsPending;
};

}
