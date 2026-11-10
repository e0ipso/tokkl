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

// A read refetches the list only when the catalog revision moved. A 404 for a
// single project is provisional: the server may reuse a deleted id.
class ProjectCatalog : public QObject
{
    Q_OBJECT

public:
    // The colour is lowercase #rrggbb, empty unless the state is Project.
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

    // Answers are dropped while accepting() is false, e.g. while the workspace
    // is refused.
    explicit ProjectCatalog(std::function<bool()> accepting, QObject *parent = nullptr);

    const QList<Project> &projects() const;
    // projects is only a prefix of the workspace's active projects.
    bool incomplete() const;
    bool listKnown() const;
    static std::optional<Project> findActive(const QList<Project> &projects, qint64 id);
    // gone is set when the project's own read answered 404.
    std::optional<Project> knownProject(qint64 id, bool *gone = nullptr) const;
    Indicator indicatorFor(std::optional<qint64> id) const;

    // Does nothing while a read is on its way. Emits listLoaded() only for a new
    // list.
    void fetch(Connection *connection);
    bool needsLookUp(qint64 id) const;
    // The answer counts only while stillWanted(id). A read that fails other
    // than with 403 emits nothing, so the next lookUp() reads again.
    void lookUp(Connection *connection, qint64 id, qint64 workspace, std::function<bool(qint64)> stillWanted);

    // The list itself stays until clearList().
    void forget();
    void clearList();
    // As forget(), and every answer on its way is dropped.
    void reset();

Q_SIGNALS:
    void listChanged();
    // After listChanged().
    void listLoaded();
    void projectResolved();
    // A Forbidden error may mean the workspace was lost.
    void readFailed(const Tokkl::ApiError &error);

private:
    void fetchList(Connection *connection, qint64 revision);

    std::function<bool()> m_accepting;
    Epoch m_epoch;
    QList<Project> m_projects;
    bool m_incomplete = false;
    std::optional<qint64> m_revision;
    bool m_listPending = false;
    // Lets a single-project read tell that it predates a list.
    quint64 m_listsRead = 0;
    std::optional<Project> m_lookedUp;
    bool m_lookedUpGone = false;
    bool m_lookedUpStale = false;
    QSet<qint64> m_lookupsPending;
};

}
