// NextStartSelection and NextStartDefaults on their own: which project and
// billable flag the next start gets, from a pick, a stop or the account's
// recent entries. timercontrollertest covers them through the controller.

#include "connection.h"
#include "fakes.h"
#include "nextstartselection.h"
#include "projectcatalog.h"

#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;
using Choice = NextStartSelection::Choice;

namespace
{
constexpr qint64 workspace = 7;
const QString instance = QStringLiteral("https://a.example.test");

Project project(qint64 id, bool active, bool billable)
{
    Project p;
    p.id = id;
    p.workspaceId = workspace;
    p.name = QStringLiteral("P%1").arg(id);
    p.active = active;
    p.billable = billable;
    return p;
}

ListedEntry listed(std::optional<qint64> projectId, bool active, bool billable, qint64 inWorkspace = workspace)
{
    ListedEntry listed;
    listed.entry.workspaceId = inWorkspace;
    listed.entry.projectId = projectId;
    listed.projectActive = active;
    listed.projectBillable = billable;
    return listed;
}

const QByteArray meBody = R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})";
const QByteArray projectsBody =
    R"([{"id":11,"workspace_id":7,"client_id":null,"client_name":null,"name":"Alpha","color":"#06aaf5","active":true,"billable":true}])";
// The newest recent entry, of project 11, which is active and billable.
const QByteArray recentBody =
    R"([{"id":8,"workspace_id":7,"project_id":11,"billable":false,"start":"2026-10-15T08:00:00Z","stop":"2026-10-15T08:01:00Z",)"
    R"("duration":60,"description":"","tags":[],"project_active":true,"project_billable":true}])";

// A connection bound to account 3 and workspace 7, with a catalog and a
// selection on it.
struct Fixture {
    FakeTransport transport;
    FakeCredentialStore store;
    Connection connection{&transport, &store, testClientName()};
    ProjectCatalog catalog{[] {
        return true;
    }};
    NextStartSelection selection{&catalog};

    bool connect()
    {
        store.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), QStringLiteral("tok"));
        connection.setInstanceUrl(instance);
        if (!QTest::qWaitFor([this] {
                return transport.requests.size() == 1;
            })) {
            return false;
        }
        transport.respond(0, FakeTransport::answer(200, meBody));
        selection.setConnection(&connection);
        selection.reset();
        return connection.isConnected();
    }

    void loadProjects()
    {
        catalog.fetch(&connection);
        transport.respondLast(FakeTransport::answer(200, projectsBody));
    }
};
}

class NextStartSelectionTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void aProjectChoiceIsNoProjectOrAnActiveProject()
    {
        const QList<Project> projects{project(11, true, true), project(12, false, true)};
        QCOMPARE(NextStartSelection::forProject(QVariant::fromValue(nullptr), projects), Choice());
        QCOMPARE(NextStartSelection::forProject(QVariant(), projects), Choice());
        QCOMPARE(NextStartSelection::forProject(0, projects), Choice());
        QCOMPARE(NextStartSelection::forProject(11, projects), (Choice{11, true}));
        // Archived, unknown, negative or not a number.
        QVERIFY(!NextStartSelection::forProject(12, projects));
        QVERIFY(!NextStartSelection::forProject(13, projects));
        QVERIFY(!NextStartSelection::forProject(-1, projects));
        QVERIFY(!NextStartSelection::forProject(QStringLiteral("eleven"), projects));
    }

    void aStopDefaultsToItsProjectWhileActive()
    {
        const QList<Project> projects{project(11, true, true), project(12, false, true)};
        QCOMPARE(NextStartSelection::afterStop(11, projects), (Choice{11, true}));
        QCOMPARE(NextStartSelection::afterStop(12, projects), Choice());
        QCOMPARE(NextStartSelection::afterStop(13, projects), Choice());
        QCOMPARE(NextStartSelection::afterStop(std::nullopt, projects), Choice());
    }

    void theNewestRecentEntryOfTheWorkspaceGivesTheDefault()
    {
        QCOMPARE(NextStartSelection::fromRecentEntries({listed(11, true, true), listed(12, true, false)}, workspace), (Choice{11, true}));
        QCOMPARE(NextStartSelection::fromRecentEntries({listed(11, false, true), listed(12, true, false)}, workspace), Choice());
        QCOMPARE(NextStartSelection::fromRecentEntries({listed(std::nullopt, false, false), listed(12, true, false)}, workspace), Choice());
        QCOMPARE(NextStartSelection::fromRecentEntries({listed(11, true, true, workspace + 1)}, workspace), Choice());
        QCOMPARE(NextStartSelection::fromRecentEntries({}, workspace), Choice());
    }

    void aPickWinsUntilAStop()
    {
        NextStartDefaults defaults;
        defaults.pick();
        QVERIFY(defaults.picked());
        defaults.waitForList(11);
        defaults.stopped();
        QVERIFY(!defaults.picked());
        QVERIFY(!defaults.takeStopDefault());
    }

    void onlyTheNewestLastEntryReadApplies()
    {
        NextStartDefaults defaults;
        const quint64 first = defaults.beginLastEntryRead();
        const quint64 second = defaults.beginLastEntryRead();
        QVERIFY(!defaults.takeLastEntryRead(first));
        QVERIFY(defaults.takeLastEntryRead(second));
        QVERIFY(!defaults.takeLastEntryRead(second));
        const quint64 third = defaults.beginLastEntryRead();
        defaults.cancelLastEntryRead();
        QVERIFY(!defaults.takeLastEntryRead(third));
    }

    void aResetAsksForTheLastEntryOnce()
    {
        NextStartDefaults defaults;
        QVERIFY(!defaults.takeLastEntryWanted());
        defaults.reset();
        QVERIFY(defaults.takeLastEntryWanted());
        QVERIFY(!defaults.takeLastEntryWanted());
    }

    void theLastEntrySetsTheChoice()
    {
        Fixture f;
        QVERIFY(f.connect());
        QVERIFY(f.selection.takeLastEntryWanted());
        QSignalSpy changed(&f.connection, &Connection::nextStartChanged);
        f.selection.readLastEntry([] {
            return true;
        });
        const HttpRequest &request = f.transport.requests.last();
        QCOMPARE(request.url.path(), QStringLiteral("/api/v9/me/time_entries"));
        QCOMPARE(request.url.query(), QStringLiteral("meta=true"));
        f.transport.respondLast(FakeTransport::answer(200, recentBody));
        QCOMPARE(f.selection.projectId(), 11);
        QVERIFY(f.selection.billable());
        QVERIFY(changed.count() > 0);
    }

    void aPickOrAStartBeforeTheAnswerKeepsItsChoice_data()
    {
        QTest::addColumn<QString>("action");
        QTest::newRow("pick") << QStringLiteral("pick");
        QTest::newRow("billable") << QStringLiteral("billable");
        QTest::newRow("start") << QStringLiteral("start");
        QTest::newRow("reset") << QStringLiteral("reset");
        QTest::newRow("no longer wanted") << QStringLiteral("unwanted");
    }

    void aPickOrAStartBeforeTheAnswerKeepsItsChoice()
    {
        QFETCH(QString, action);
        Fixture f;
        QVERIFY(f.connect());
        bool wanted = true;
        f.selection.readLastEntry([&wanted] {
            return wanted;
        });
        const qsizetype read = f.transport.requests.size() - 1;
        if (action == QLatin1String("pick")) {
            f.selection.pick(Choice());
        } else if (action == QLatin1String("billable")) {
            f.selection.pickBillable(false);
        } else if (action == QLatin1String("start")) {
            f.selection.started();
        } else if (action == QLatin1String("reset")) {
            f.selection.reset();
        } else {
            wanted = false;
        }
        f.transport.respond(read, FakeTransport::answer(200, recentBody));
        QVERIFY(!f.selection.projectId());
        QVERIFY(!f.selection.billable());
    }

    void aPickSkipsTheRead()
    {
        Fixture f;
        QVERIFY(f.connect());
        f.selection.pickProjectId(QVariant::fromValue(nullptr));
        const qsizetype before = f.transport.requests.size();
        f.selection.readLastEntry([] {
            return true;
        });
        QCOMPARE(f.transport.requests.size(), before);
    }

    void aFailedReadAsksAgain()
    {
        Fixture f;
        QVERIFY(f.connect());
        QVERIFY(f.selection.takeLastEntryWanted());
        f.selection.readLastEntry([] {
            return true;
        });
        f.transport.respondLast(FakeTransport::answer(500, "{}"));
        QVERIFY(f.selection.takeLastEntryWanted());
    }

    void aStopBeforeTheProjectListWaitsForIt()
    {
        Fixture f;
        QVERIFY(f.connect());
        f.selection.stopped(11);
        QVERIFY(!f.selection.projectId());
        f.loadProjects();
        f.selection.listLoaded();
        QCOMPARE(f.selection.projectId(), 11);
        QVERIFY(f.selection.billable());
    }

    void aPickAfterTheStopReplacesTheWaitingDefault()
    {
        Fixture f;
        QVERIFY(f.connect());
        f.selection.stopped(11);
        f.selection.pickBillable(false);
        f.loadProjects();
        f.selection.listLoaded();
        QVERIFY(!f.selection.projectId());
    }

    void aStopOfAnUnknownProjectClearsTheChoice()
    {
        Fixture f;
        QVERIFY(f.connect());
        f.loadProjects();
        f.selection.pick(Choice{11, true});
        f.selection.stopped(12);
        QVERIFY(!f.selection.projectId());
        QVERIFY(!f.selection.billable());
        f.selection.stopped(11);
        QCOMPARE(f.selection.projectId(), 11);
    }

    void forgetClearsTheChoice()
    {
        Fixture f;
        QVERIFY(f.connect());
        f.loadProjects();
        f.selection.pick(Choice{11, true});
        f.selection.forget();
        QVERIFY(!f.selection.projectId());
        QVERIFY(!f.selection.billable());
    }

    void withoutAConnectionNothingIsChosen()
    {
        ProjectCatalog catalog([] {
            return true;
        });
        NextStartSelection selection(&catalog);
        selection.pick(Choice{11, true});
        selection.pickBillable(true);
        QVERIFY(!selection.projectId());
        QVERIFY(selection.projectIdVariant().isNull());
        QVERIFY(!selection.billable());
    }
};

QTEST_GUILESS_MAIN(NextStartSelectionTest)

#include "nextstartselectiontest.moc"
