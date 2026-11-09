#pragma once

#include <QtGlobal>

#include <optional>
#include <utility>

namespace Tokkl
{

// When an automatic default may set the project of the next start.
//
// Two defaults exist: the project of the entry that just stopped, and, when
// a context starts with nothing running, the project of the account's
// newest entry. A pick by the user wins over both until the next start or
// stop. A stop seen before the project list is known keeps its project
// here until the list can tell whether it is still active. A last-entry
// read applies only while it is the newest one and nothing replaced its
// choice since it was sent.
class NextStartDefaults
{
public:
    bool picked() const
    {
        return m_picked;
    }

    // The user chose: no default replaces the choice until clear().
    void pick()
    {
        m_picked = true;
        m_stopDefault.reset();
        m_lastEntryRead = 0;
    }

    // A start, or the workspace went away: the pick, a waiting stop default
    // and a last-entry read on its way no longer apply.
    void clear()
    {
        m_picked = false;
        m_stopDefault.reset();
        m_lastEntryRead = 0;
    }

    // A new context: as clear(), and the last entry is asked for after the
    // first state.
    void reset()
    {
        clear();
        m_lastEntryWanted = true;
    }

    // An entry stopped: a pick made before it no longer applies.
    void stopped()
    {
        m_picked = false;
        m_stopDefault.reset();
    }

    // The stopped entry's project, for when the project list arrives.
    void waitForList(qint64 projectId)
    {
        m_stopDefault = projectId;
    }

    std::optional<qint64> takeStopDefault()
    {
        return std::exchange(m_stopDefault, std::nullopt);
    }

    // Ask for the last entry after the next state.
    void wantLastEntry()
    {
        m_lastEntryWanted = true;
    }

    bool takeLastEntryWanted()
    {
        return std::exchange(m_lastEntryWanted, false);
    }

    bool lastEntryWanted() const
    {
        return m_lastEntryWanted;
    }

    // Numbers a new last-entry read, which replaces any earlier one.
    quint64 beginLastEntryRead()
    {
        m_lastEntryRead = ++m_lastEntryReads;
        return m_lastEntryRead;
    }

    // The read numbered number may still set the default. Once asked, it
    // may not again.
    bool takeLastEntryRead(quint64 number)
    {
        if (m_lastEntryRead != number) {
            return false;
        }
        m_lastEntryRead = 0;
        return true;
    }

    // A choice made since makes any last-entry read on its way older.
    void cancelLastEntryRead()
    {
        m_lastEntryRead = 0;
    }

private:
    bool m_picked = false;
    std::optional<qint64> m_stopDefault;
    bool m_lastEntryWanted = false;
    quint64 m_lastEntryReads = 0;
    quint64 m_lastEntryRead = 0; // the read that may apply, or 0
};

}
