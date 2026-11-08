#pragma once

#include "apitypes.h"
#include "epoch.h"

#include <QDateTime>
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
// The first read of a context pages in the whole list. Later reads ask only
// for the projects changed since the newest change the reads brought, less
// changesMarginMs, and merge them: a changed project is replaced and an
// archived one dropped. The whole list is read again when a read asks for
// it, when the list is cut short or has no change times, when the last
// whole read is fullListMaxAgeMs old, and when the changes hold something
// whose place in the list is unknown: a new or unarchived project, a
// renamed one, or a full page. The server deletes a project without a
// trace, so only a whole read drops a deleted one.
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

    // What a read of the list asks for.
    enum class ListRead {
        Changes, // the changes since the last read, when they can be merged
        Full, // the whole list
    };

    // How far before the newest change a read of the changes starts, for a
    // change the server stamped earlier but saved later.
    static constexpr qint64 changesMarginMs = 60 * 1000;
    // How old the last whole read may be before a read of the changes reads
    // the whole list again.
    static constexpr qint64 fullListMaxAgeMs = 60 * 60 * 1000;

    // accepting() is false while answers must be dropped, such as while the
    // workspace is refused.
    explicit ProjectCatalog(std::function<bool()> accepting, QObject *parent = nullptr);

    const QList<Project> &projects() const;
    // The list is a prefix of the workspace's active projects.
    bool incomplete() const;
    // A list has been read in this context.
    bool listKnown() const;
    // The active project with this id, or nullopt.
    std::optional<Project> activeProject(qint64 id) const;
    // The active project with this id in projects, or nullopt.
    static std::optional<Project> findActive(const QList<Project> &projects, qint64 id);
    // The project from the list, else from its own read. gone is set when
    // that read answered 404.
    std::optional<Project> knownProject(qint64 id, bool *gone = nullptr) const;
    Indicator indicatorFor(std::optional<qint64> id) const;

    // Reads the list, unless a read is already on its way; a Full read asked
    // for then follows it. now is this device's clock, invalid when there is
    // none, which reads the whole list. Emits listLoaded() with the answer,
    // or readFailed().
    void fetch(Connection *connection, const QDateTime &now, ListRead read);
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
    void fetchAll(Connection *connection, const QDateTime &now);
    void fetchChanges(Connection *connection, const QDateTime &now);
    // Takes in a read list and tells of it.
    void loaded();
    // The newest change time of projects, or nullopt when one has none.
    static std::optional<QDateTime> newestChange(const QList<Project> &projects);
    // Merges the changes into the list, or returns false when their place in
    // it is unknown.
    bool merge(const QList<Project> &changes);

    std::function<bool()> m_accepting;
    Epoch m_epoch;
    QList<Project> m_projects;
    bool m_incomplete = false;
    bool m_listKnown = false;
    bool m_listPending = false;
    // A Full read was asked for while a read of the changes was on its way.
    bool m_fullWanted = false;
    // This device's clock at the last whole read sent; invalid before one.
    QDateTime m_fullReadAt;
    // The newest change time the reads brought, on the server's clock; none
    // when a project came without one.
    std::optional<QDateTime> m_newestChange;
    // Counts the lists read, so a single-project read can tell it predates
    // one.
    quint64 m_listRevision = 0;
    std::optional<Project> m_lookedUp;
    bool m_lookedUpGone = false;
    // A list was read after m_lookedUp, so it is read again.
    bool m_lookedUpStale = false;
    QSet<qint64> m_lookupsPending;
};

}
