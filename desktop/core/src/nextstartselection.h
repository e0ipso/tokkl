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

// A user pick, or the active project of the stopped or newest entry. A pick
// wins until the next start or stop.
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

    Choice choice() const;
    std::optional<qint64> projectId() const;
    QVariant projectIdVariant() const;
    bool billable() const;
    // Null or 0 for no project, else an active project with its billable
    // default; nullopt for anything else.
    std::optional<Choice> choiceFor(const QVariant &projectId) const;

    void pick(const Choice &choice);
    void pickBillable(bool billable);

    // A default that answers later must not replace the started choice.
    void started();
    // A last-entry read on its way is older than the running entry's choice.
    void entryRunning();
    // Before the project list is known, the default waits for it.
    void stopped(std::optional<qint64> projectId);
    void listLoaded();
    void forget();
    // Also drops every answer on its way and asks for the last entry after the
    // first state.
    void reset();

    void wantLastEntry();
    // True once after wantLastEntry() or reset().
    bool takeLastEntryWanted();
    // Skipped if the user picked. The answer applies only while it is the newest
    // read and nothing was chosen since; a failure asks again after the next state.
    void readLastEntry(std::function<bool()> stillWanted);

Q_SIGNALS:
    void changed();

private:
    void apply(const Choice &choice);
    void set(const Choice &choice);
    void clear();

    const ProjectCatalog *m_catalog;
    Connection &m_connection;
    Choice m_choice;
    bool m_picked = false;
    std::optional<qint64> m_stopDefault;
    bool m_lastEntryWanted = false;
    quint64 m_lastEntryReads = 0;
    quint64 m_lastEntryRead = 0;
    // Advanced by reset(); last-entry reads from before do nothing.
    Epoch m_epoch;
};

}
