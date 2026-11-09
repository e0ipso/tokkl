#pragma once

#include "apitypes.h"
#include "epoch.h"

#include <QObject>
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
// context starts with nothing running it uses the project of the account's
// newest entry. Only an active project of the workspace counts, and
// any other gives no project. A pick by the user wins over both until the
// next start or stop. A TimerModel owns the selection; its TimerController picks through it.
class NextStartSelection : public QObject
{
    Q_OBJECT

public:
    struct Choice {
        std::optional<qint64> projectId;
        bool billable = false;

        bool operator==(const Choice &other) const = default;
    };

    // Neither is owned; both must outlive the selection.
    NextStartSelection(const ProjectCatalog *catalog, Connection &connection, QObject *parent = nullptr);

    // The project and billable flag a start sends.
    Choice choice() const;
    std::optional<qint64> projectId() const;
    QVariant projectIdVariant() const;
    bool billable() const;
    // Null or 0 for no project, else an active project with its billable
    // default; nullopt for anything else.
    std::optional<Choice> choiceFor(const QVariant &projectId) const;

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
    // Reads the account's newest entry for the default, unless the user
    // picked. The answer applies only while it is the newest read, nothing
    // was chosen since, and stillWanted() is true. A failed read asks again
    // after the next state.
    void readLastEntry(std::function<bool()> stillWanted);

Q_SIGNALS:
    // The project or the billable flag changed.
    void changed();

private:
    void apply(const Choice &choice);
    void set(const Choice &choice);
    // The pick, a stop default waiting for the list and a last-entry read
    // on its way no longer apply.
    void clear();

    const ProjectCatalog *m_catalog;
    Connection &m_connection;
    Choice m_choice;
    bool m_picked = false;
    // A stopped entry's project, waiting for the project list.
    std::optional<qint64> m_stopDefault;
    bool m_lastEntryWanted = false;
    quint64 m_lastEntryReads = 0;
    // The last-entry read that may still apply, or 0.
    quint64 m_lastEntryRead = 0;
    // Advanced by reset(); last-entry reads from before do nothing.
    Epoch m_epoch;
};

}
