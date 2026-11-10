#include "mutationgate.h"
#include "projectchoices.h"
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
    void noStateShowsNothing()
    {
        const TimerView view = TimerView::of(std::nullopt, workspace, false);
        QVERIFY(!view.entry);
        QVERIFY(!view.chain);
        QVERIFY(!view.session);
        QVERIFY(!view.paused());
    }

    void theStateShowsItsEntryAndChain()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pause = chain(false, 1);
        const TimerView view = TimerView::of(held, workspace, false);
        QCOMPARE(view.entry->id, 1);
        QCOMPARE(view.chain->cloneEntryId, std::optional<qint64>(1));
        QVERIFY(!view.paused());

        TimerState paused = state(2);
        paused.pause = chain(true);
        QVERIFY(TimerView::of(paused, workspace, false).paused());
    }

    void anotherWorkspaceIsLeftOut()
    {
        TimerState held = state(1);
        held.runningEntry = running(1, workspace + 1);
        QVERIFY(!TimerView::of(held, workspace, false).entry);
        QVERIFY(TimerView::of(held, workspace + 1, false).entry);
    }

    void aHiddenWorkspaceShowsNothing()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pause = chain(false, 1);
        const TimerView view = TimerView::of(held, workspace, true);
        QVERIFY(!view.entry);
        QVERIFY(!view.chain);
    }

    void aSessionsPomodoroIsTheSessions()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pomodoro = TimerPomodoro();
        held.pomodoro->entryId = 1;
        const TimerView view = TimerView::of(held, workspace, false);
        QVERIFY(view.session);
        QVERIFY(!view.entry);
    }

    void aChainWhoseCloneIsNotTheEntryIsDropped()
    {
        TimerState held = state(1);
        held.runningEntry = running(1);
        held.pause = chain(false, 2);
        QVERIFY(TimerView::of(held, workspace, false).entry);
        QVERIFY(!TimerView::of(held, workspace, false).chain);
        TimerState stopped = state(2);
        stopped.pause = chain(false, 2);
        QVERIFY(!TimerView::of(stopped, workspace, false).chain);
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

    void anAppliedTimerActionReadsNothing()
    {
        MutationGate gate;
        gate.begin();
        QVERIFY(gate.running());
        const MutationGate::Ending ending = gate.finish(Outcome::Applied, ApiError(), true);
        QVERIFY(!gate.running());
        QCOMPARE(ending.message, Message::Clear);
        QVERIFY(!ending.settle);
        QVERIFY(!ending.refresh);
    }

    void anUnknownOutcomeSettles()
    {
        MutationGate gate;
        gate.begin();
        const MutationGate::Ending ending = gate.finish(Outcome::Unknown, error(ApiError::Kind::Timeout), false);
        QVERIFY(ending.settle);
        QVERIFY(!ending.refresh);
        QCOMPARE(ending.message, Message::Show);
    }

    void aWriteInFlightWhenTheWorkspaceGoesSettles()
    {
        MutationGate gate;
        gate.settleWhenDone(); // nothing runs: nothing to settle
        gate.begin();
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false).settle);
        gate.begin();
        gate.settleWhenDone();
        QVERIFY(gate.finish(Outcome::Applied, ApiError(), false).settle);
        gate.begin();
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false).settle);
    }

    void aConflictSaysSo()
    {
        MutationGate gate;
        gate.begin();
        QCOMPARE(gate.finish(Outcome::Conflict, error(ApiError::Kind::Client), true).message, Message::Conflict);
    }

    void aForbiddenWriteLosesTheWorkspace()
    {
        MutationGate gate;
        gate.begin();
        QCOMPARE(gate.finish(Outcome::Refused, error(ApiError::Kind::Forbidden), false).message, Message::LoseWorkspace);
    }

    void aWriteRefusedBeforeSendingReadsNothing()
    {
        MutationGate gate;
        for (const ApiError::Kind kind : {ApiError::Kind::RateLimited, ApiError::Kind::NotConnected, ApiError::Kind::AuthenticationPaused}) {
            gate.begin();
            const MutationGate::Ending ending = gate.finish(Outcome::Refused, error(kind), true);
            QCOMPARE(ending.message, Message::Show);
            QVERIFY(!ending.refresh);
        }
    }

    void aRefusedStartKeepsItsMessageAndReads()
    {
        MutationGate gate;
        gate.begin();
        MutationGate::Ending ending = gate.finish(Outcome::Refused, error(ApiError::Kind::Client), true);
        QCOMPARE(ending.message, Message::Keep);
        QVERIFY(ending.refresh);
        QVERIFY(!ending.settle);
        gate.begin();
        ending = gate.finish(Outcome::Refused, error(ApiError::Kind::Client), false);
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
        QVERIFY(!gate.finish(Outcome::Applied, ApiError(), false).settle);
    }

    void projectChoicesOrderTheMenu()
    {
        Project alpha;
        alpha.id = 11;
        alpha.name = QStringLiteral("Alpha");
        Project beta = alpha;
        beta.id = 12;
        beta.name = QStringLiteral("Beta");
        Project legacy = alpha;
        legacy.id = 33;
        legacy.active = false;
        using Kind = ProjectChoices::Row::Kind;

        ProjectChoices choices = ProjectChoices::build({alpha, beta}, false, 12, std::nullopt, true);
        QVERIFY(choices.choosable);
        QVERIFY(!choices.noProjectChecked);
        QVERIFY(!choices.incomplete());
        QCOMPARE(choices.rows.size(), 2);
        QVERIFY(choices.rows.at(0).kind == Kind::Project && !choices.rows.at(0).checked && choices.rows.at(0).enabled);
        QVERIFY(choices.rows.at(1).checked);

        choices = ProjectChoices::build({alpha, beta}, true, 33, legacy, false);
        QCOMPARE(choices.rows.size(), 4);
        QVERIFY(choices.rows.at(0).kind == Kind::Archived && choices.rows.at(0).checked && !choices.rows.at(0).enabled);
        QCOMPARE(choices.rows.at(0).project.id, 33);
        QVERIFY(choices.rows.at(1).kind == Kind::Incomplete && !choices.rows.at(1).enabled);
        QVERIFY(choices.incomplete());
        QVERIFY(!choices.rows.at(2).enabled && !choices.rows.at(3).enabled);

        choices = ProjectChoices::build({alpha}, false, std::nullopt, alpha, false);
        QCOMPARE(choices.rows.size(), 1);
        QVERIFY(choices.noProjectChecked);

        const QVariantList rows = ProjectChoices::build({alpha}, true, 11, legacy, true).toVariantList();
        QCOMPARE(rows.size(), 3);
        QCOMPARE(rows.at(0).toMap().value(QStringLiteral("kind")).toString(), QStringLiteral("archived"));
        QCOMPARE(rows.at(1).toMap().value(QStringLiteral("kind")).toString(), QStringLiteral("incomplete"));
        QVERIFY(rows.at(1).toMap().value(QStringLiteral("project")).toMap().isEmpty());
        QCOMPARE(rows.at(2).toMap().value(QStringLiteral("project")).toMap().value(QStringLiteral("id")).toLongLong(), 11);
        QVERIFY(!rows.at(2).toMap().contains(QStringLiteral("checked")));
        const QVariantMap archivedLabel = rows.at(0).toMap().value(QStringLiteral("label")).toMap();
        QCOMPARE(archivedLabel.value(QStringLiteral("name")).toString(), legacy.name);
        QCOMPARE(archivedLabel.value(QStringLiteral("archived")).toBool(), true);
        QVERIFY(rows.at(1).toMap().value(QStringLiteral("label")).toMap().isEmpty());
        QCOMPARE(rows.at(2).toMap().value(QStringLiteral("label")).toMap().value(QStringLiteral("archived")).toBool(), false);
    }

    void projectLabelParts()
    {
        using Kind = ProjectLabelParts::Kind;
        Project project;
        project.id = 4;
        project.name = QStringLiteral("Website");
        project.clientName = QStringLiteral("Acme");
        ProjectLabelParts parts = ProjectLabelParts::of(project);
        QCOMPARE(parts, (ProjectLabelParts{QStringLiteral("Website"), QStringLiteral("Acme"), false, false, Kind::Named}));
        project.active = false;
        QVERIFY(ProjectLabelParts::of(project).archived);
        QCOMPARE(ProjectLabelParts::of(project).kind, Kind::Named);
        project.name.clear();
        parts = ProjectLabelParts::of(project);
        QCOMPARE(parts, (ProjectLabelParts{QString(), QString(), false, true, Kind::Unavailable}));
        QCOMPARE(parts.toVariantMap(),
                 (QVariantMap{{QStringLiteral("name"), QString()},
                              {QStringLiteral("client"), QString()},
                              {QStringLiteral("archived"), false},
                              {QStringLiteral("missing"), true},
                              {QStringLiteral("kind"), QStringLiteral("unavailable")}}));
        QCOMPARE(ProjectLabelParts(), (ProjectLabelParts{QString(), QString(), false, false, Kind::None}));
        QCOMPARE(ProjectLabelParts().toVariantMap().value(QStringLiteral("kind")), QVariant(QStringLiteral("none")));
        QCOMPARE(ProjectLabelParts::unknown(), (ProjectLabelParts{QString(), QString(), false, false, Kind::Unknown}));
        QCOMPARE(ProjectLabelParts::unknown().toVariantMap().value(QStringLiteral("kind")), QVariant(QStringLiteral("unknown")));
        QCOMPARE(ProjectLabelParts::kindKey(Kind::Named), QStringLiteral("named"));
    }
};

QTEST_GUILESS_MAIN(TimerPartsTest)

#include "timerpartstest.moc"
