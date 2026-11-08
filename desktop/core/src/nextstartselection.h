#pragma once

#include "apitypes.h"
#include "epoch.h"
#include "nextstartdefaults.h"

#include <QObject>
#include <QPointer>
#include <QVariant>

#include <functional>
#include <optional>

namespace Tokkl
{

class Connection;
class ProjectCatalog;

// The project and billable flag of the next start, and the automatic
// defaults that set them. The choice goes with the context: reset(), as for
// another account, and a new connection clear it.
//
// After a stop the next start uses the stopped entry's project; when a
// context starts with nothing running it uses the project of the newest
// entry the API lists. Only an active project of the workspace counts, and
// any other gives no project. A pick by the user wins over both until the
// next start or stop. NextStartDefaults decides when a default may still
// apply.
class NextStartSelection : public QObject
{
    Q_OBJECT

public:
    struct Choice {
        std::optional<qint64> projectId;
        bool billable = false;

        bool operator==(const Choice &other) const = default;
    };

    // The choice for a project the menu offers: null or 0 for no project,
    // else an active project of projects with its billable default.
    // nullopt for anything else.
    static std::optional<Choice> forProject(const QVariant &projectId, const QList<Project> &projects);
    // The default after an entry of projectId stopped.
    static Choice afterStop(std::optional<qint64> projectId, const QList<Project> &projects);
    // The default from the account's recent entries, newest first.
    static Choice fromRecentEntries(const QList<ListedEntry> &entries, qint64 workspaceId);

    // The catalog is not owned and must outlive the selection.
    explicit NextStartSelection(const ProjectCatalog *catalog, QObject *parent = nullptr);

    // Not owned. Null leaves nothing to choose for. Either way the choice
    // is cleared.
    void setConnection(Connection *connection);

    std::optional<qint64> projectId() const;
    QVariant projectIdVariant() const;
    bool billable() const;

    // A pick by the user, which no default replaces until the next start or
    // stop.
    void pick(const Choice &choice);
    void pickBillable(bool billable);

    // A start or resume was sent: a default that answers later must not
    // replace its choice, and a pick lasts only until it.
    void started();
    // An entry runs: a last-entry read on its way is older than its choice.
    void entryRunning();
    // The entry shown stopped with projectId. Before the project list is
    // known, the default waits for it.
    void stopped(std::optional<qint64> projectId);
    // A project list arrived: a stop default that waited for it applies.
    void listLoaded();
    // The workspace went away: no project and not billable, and no default
    // or pick applies.
    void forget();
    // A new context: the choice is cleared, no default or pick applies,
    // every answer on its way is dropped, and the last entry is asked for
    // after the first state.
    void reset();

    // Ask for the last entry after the next state.
    void wantLastEntry();
    // True once after wantLastEntry() or reset().
    bool takeLastEntryWanted();
    // Reads the account's recent entries for the default, unless the user
    // picked: the entries that started in the lastEntryFirstDays before now
    // (the server's clock), and only when there are none the API's last 9
    // days. Without a valid now, the 9 days at once. The answer applies only
    // while it is the newest read, nothing was chosen since, and
    // stillWanted() is true. A failed read asks again after the next state.
    void readLastEntry(std::function<bool()> stillWanted, const QDateTime &now);

    // The days the first read for the last entry covers. A busy account's
    // 9 days of entries can be large, and the last entry is nearly always
    // this recent.
    static constexpr int lastEntryFirstDays = 2;

Q_SIGNALS:
    // The project or the billable flag changed.
    void changed();

private:
    // One read for the last entry numbered number: from now's window when
    // now is valid, else the 9 days.
    void readEntries(quint64 number, const QDateTime &now, std::function<bool()> stillWanted);
    void apply(const Choice &choice);
    void set(const Choice &choice);

    const ProjectCatalog *m_catalog;
    QPointer<Connection> m_connection;
    Choice m_choice;
    NextStartDefaults m_defaults;
    // Advanced by reset(); last-entry reads from before do nothing.
    Epoch m_epoch;
};

}
