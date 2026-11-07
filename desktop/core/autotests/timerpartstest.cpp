// TimerView and MutationGate on their own: which state the controller shows
// and what the end of a write asks of it. timercontrollertest covers them
// through the controller.

#include "mutationgate.h"
#include "timerview.h"

#include <QTest>
#include <QTimeZone>

using namespace Tokkl;
using Outcome = TimerActionResult::Outcome;
using Message = MutationGate::Message;

namespace
{
constexpr qint64 workspace = 42;

TimeEntry running(qint64 id, qint64 inWorkspace = workspace)
{
    TimeEntry entry;
    entry.id = id;
    entry.workspaceId = inWorkspace;
    entry.start = QDateTime(QDate(2026, 10, 16), QTime(9, 0), QTimeZone::UTC);
    entry.duration = -1;
    return entry;
}

TimerState state(qint64 revision)
{
    TimerState state;
    state.revision = revision;
    return state;
}

TimerPause chain(bool paused, std::optional<qint64> clone = std::nullopt)
{
    TimerPause pause;
    pause.paused = paused;
    pause.workspaceId = workspace;
    pause.seconds = 600;
    pause.cloneEntryId = clone;
    return pause;
}

ApiError error(ApiError::Kind kind)
{
    ApiError e;
    e.kind = kind;
    return e;
}
}

class TimerPartsTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void aPatchStaysUntilANewerRevision()
    {
        TimerView view;
        QVERIFY(view.adopt(state(5)));
        QVERIFY(view.patch(5, running(1)));
        // A read answered before the write cannot undo its reply.
        QVERIFY(!view.adopt(state(5)));
        QCOMPARE(view.state()->runningEntry->id, 1);
        QVERIFY(view.adopt(state(6)));
        QVERIFY(!view.state()->runningEntry);
    }

    void anUnpatchedStateTakesAnyRevision()
    {
        TimerView view;
        QVERIFY(view.adopt(state(5)));
        QVERIFY(view.adopt(state(4)));
        QCOMPARE(view.state()->revision, 4);
    }

    void aPatchSentBeforeANewerStateDoesNothing()
    {
        TimerView view;
        QVERIFY(!view.patch(1, running(1)));
        view.adopt(state(7));
        QVERIFY(!view.patch(6, running(1)));
        QVERIFY(!view.state()->runningEntry);
    }

    void aPatchEndsTheChainAndSessionItLeavesNoPlaceFor()
    {
        TimerState held = state(3);
        held.runningEntry = running(1);
        held.pause = chain(false, 1);
        held.pomodoro = TimerPomodoro();
        held.pomodoro->entryId = 1;
        TimerView view;
        view.adopt(held);
        // A stop: no clone runs, and the chain was not paused.
        QVERIFY(view.patch(3, std::nullopt));
        QVERIFY(!view.state()->pause);
        QVERIFY(!view.state()->pomodoro);
    }

    void aPatchKeepsAPausedChainWhileNothingRuns()
    {
        TimerState held = state(3);
        held.pause = chain(true);
        TimerView view;
        view.adopt(held);
        QVERIFY(view.patch(3, std::nullopt));
        QVERIFY(view.state()->pause);
    }

    void shownLeavesOutAnotherWorkspace()
    {
        TimerState held = state(1);
        held.runningEntry = running(1, workspace + 1);
        TimerView view;
        view.adopt(held);
        QVERIFY(!view.shown(workspace, false).entry);
        QVERIFY(view.shown(workspace + 1, false).entry);
    }

    void shownHidesEverythingOfAHiddenWorkspace()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pause = chain(false, 1);
        TimerView view;
        view.adopt(held);
        const TimerView::Shown shown = view.shown(workspace, true);
        QVERIFY(!shown.entry);
        QVERIFY(!shown.chain);
    }

    void shownGivesASessionsPomodoroToTheSession()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pomodoro = TimerPomodoro();
        held.pomodoro->entryId = 1;
        TimerView view;
        view.adopt(held);
        const TimerView::Shown shown = view.shown(workspace, false);
        QVERIFY(shown.session);
        QVERIFY(!shown.entry);
    }

    void shownDropsAChainWhoseCloneIsNotTheEntry()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pause = chain(false, 2);
        TimerView view;
        view.adopt(held);
        QVERIFY(view.shown(workspace, false).entry);
        QVERIFY(!view.shown(workspace, false).chain);
    }

    void sameChainComparesWhatThePanelShows()
    {
        TimerPause a = chain(true);
        TimerPause b = a;
        b.description = QStringLiteral("not shown");
        QVERIFY(TimerView::sameChain(a, b));
        b.seconds += 60;
        QVERIFY(!TimerView::sameChain(a, b));
        QVERIFY(!TimerView::sameChain(a, std::nullopt));
        QVERIFY(TimerView::sameChain(std::nullopt, std::nullopt));
    }

    void anAppliedEntryWriteReadsTheRest()
    {
        MutationGate gate;
        gate.begin();
        QVERIFY(gate.running());
        const MutationGate::Ending ending = gate.finish(Outcome::Applied, ApiError(), false, true);
        QVERIFY(!gate.running());
        QVERIFY(ending.readRest);
        QVERIFY(!ending.settle);
        QCOMPARE(ending.message, Message::Clear);
    }

    void anUnknownOutcomeSettles()
    {
        MutationGate gate;
        gate.begin();
        const MutationGate::Ending ending = gate.finish(Outcome::Unknown, error(ApiError::Kind::Timeout), false, true);
        QVERIFY(ending.settle);
        QVERIFY(!ending.readRest);
        QCOMPARE(ending.message, Message::Show);
    }

    void aWriteInFlightWhenTheWorkspaceGoesSettles()
    {
        MutationGate gate;
        gate.settleWhenDone(); // nothing runs: nothing to settle
        gate.begin();
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false, false).settle);
        gate.begin();
        gate.settleWhenDone();
        QVERIFY(gate.finish(Outcome::Applied, ApiError(), false, false).settle);
        // Asked once.
        gate.begin();
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false, false).settle);
    }

    void aConflictSaysSo()
    {
        MutationGate gate;
        gate.begin();
        QCOMPARE(gate.finish(Outcome::Conflict, error(ApiError::Kind::Client), true, false).message, Message::Conflict);
    }

    void aForbiddenWriteLosesTheWorkspace()
    {
        MutationGate gate;
        gate.begin();
        QCOMPARE(gate.finish(Outcome::Refused, error(ApiError::Kind::Forbidden), false, true).message, Message::LoseWorkspace);
    }

    void aWriteRefusedBeforeSendingReadsNothing()
    {
        MutationGate gate;
        for (const ApiError::Kind kind : {ApiError::Kind::RateLimited, ApiError::Kind::NotConnected, ApiError::Kind::AuthenticationPaused}) {
            gate.begin();
            const MutationGate::Ending ending = gate.finish(Outcome::Refused, error(kind), true, false);
            QCOMPARE(ending.message, Message::Show);
            QVERIFY(!ending.refresh);
        }
    }

    void aRefusedStartKeepsItsMessageAndReads()
    {
        MutationGate gate;
        gate.begin();
        MutationGate::Ending ending = gate.finish(Outcome::Refused, error(ApiError::Kind::Client), true, true);
        QCOMPARE(ending.message, Message::Keep);
        QVERIFY(ending.refresh);
        QVERIFY(!ending.readRest);
        gate.begin();
        ending = gate.finish(Outcome::Refused, error(ApiError::Kind::Client), false, true);
        QCOMPARE(ending.message, Message::Show);
        QVERIFY(ending.refresh);
    }

    void resetForgetsTheWrite()
    {
        MutationGate gate;
        gate.begin();
        gate.settleWhenDone();
        gate.reset();
        QVERIFY(!gate.running());
        gate.begin();
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false, false).settle);
    }
};

QTEST_GUILESS_MAIN(TimerPartsTest)

#include "timerpartstest.moc"
