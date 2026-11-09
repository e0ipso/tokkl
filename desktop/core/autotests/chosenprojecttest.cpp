// ChosenProject on its own, with the catalog's read of a project the list
// lacks, as the timer starts it: what the menu and the panel indicator show of the chosen project,
// and when the project is read. timercontrollertest covers both through the
// controller.

#include "chosenproject.h"
#include "connection.h"
#include "fakes.h"
#include "projectcatalog.h"

#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;
using State = ProjectCatalog::Indicator::State;

namespace
{
constexpr qint64 workspace = 7;
const QString instance = QStringLiteral("https://a.example.test");
const QByteArray meBody = R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})";
const QByteArray projectsBody =
    R"([{"id":11,"workspace_id":7,"client_id":null,"client_name":null,"name":"Alpha","color":"#06AAF5","active":true,"billable":true}])";
const QByteArray archivedBody = R"({"id":33,"workspace_id":7,"client_id":null,"client_name":null,"name":"Old","color":"#112233","active":false,"billable":false})";

struct Fixture {
    FakeTransport transport;
    FakeCredentialStore store;
    FakeClock clock;
    Connection connection{&transport, &store, clock, testClientName()};
    ProjectCatalog catalog{[] {
        return true;
    }};
    std::optional<qint64> chosen;
    ChosenProject project{&catalog};

    bool connectAndList()
    {
        store.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), QStringLiteral("tok"));
        connection.setInstanceUrl(instance);
        if (!QTest::qWaitFor([this] {
                return transport.requests.size() == 1;
            })) {
            return false;
        }
        transport.respond(0, FakeTransport::answer(200, meBody));
        // The list read follows the catalog revision's answer.
        catalog.fetch(&connection);
        if (!QTest::qWaitFor([this] {
                return transport.requests.size() == 2;
            })) {
            return false;
        }
        transport.respondLast(FakeTransport::answer(200, projectsBody));
        return connection.isConnected() && catalog.listKnown();
    }

    // What the timer does for a choice (TimerModel::lookUpProject()): reads
    // the project when the list lacks it, then has it shown.
    void choose(std::optional<qint64> id, bool ofEntry, Connection *readVia)
    {
        chosen = id;
        if (id && readVia && catalog.needsLookUp(*id)) {
            catalog.lookUp(readVia, *id, workspace, [this](qint64 projectId) {
                return chosen == projectId;
            });
        }
        project.show(id, ofEntry);
    }

    void choose(std::optional<qint64> id, bool ofEntry)
    {
        choose(id, ofEntry, &connection);
    }

    qsizetype projectReads(qint64 id) const
    {
        const QString path = QStringLiteral("/api/v9/workspaces/7/projects/%1").arg(id);
        qsizetype count = 0;
        for (const HttpRequest &request : transport.requests) {
            count += request.url.path() == path ? 1 : 0;
        }
        return count;
    }
};
}

class ChosenProjectTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void noProjectShowsNothing()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        f.choose(std::nullopt, true);
        QCOMPARE(f.project.indicator().state, State::None);
        QVERIFY(f.project.indicator().color.isEmpty());
        QVERIFY(!f.project.entryProject());
        QVERIFY(!f.project.details(std::nullopt, true));
    }

    void aListedProjectShowsItsColourInLowerCase()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        QSignalSpy indicator(&f.project, &ChosenProject::indicatorChanged);
        f.choose(11, false);
        QCOMPARE(f.project.indicator().state, State::Project);
        QCOMPARE(f.project.indicator().color, QStringLiteral("#06aaf5"));
        QCOMPARE(indicator.count(), 1);
        // The next start's project is no entry's.
        QVERIFY(!f.project.entryProject());
        QCOMPARE(f.project.details(11, false)->name, QStringLiteral("Alpha"));
        QCOMPARE(f.projectReads(11), 0);
        // The same answer again changes nothing.
        f.choose(11, false);
        QCOMPARE(indicator.count(), 1);
    }

    void anEntrysProjectIsItsOwn()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        QSignalSpy entry(&f.project, &ChosenProject::entryProjectChanged);
        f.choose(11, true);
        QCOMPARE(f.project.entryProject()->id, 11);
        QCOMPARE(entry.count(), 1);
        f.choose(std::nullopt, false);
        QVERIFY(!f.project.entryProject());
        QCOMPARE(entry.count(), 2);
    }

    void anUnlistedProjectIsReadOnItsOwn()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        f.choose(33, true);
        QCOMPARE(f.project.indicator().state, State::Pending);
        QCOMPARE(f.projectReads(33), 1);
        // One read per project while it is on its way.
        f.choose(33, true);
        QCOMPARE(f.projectReads(33), 1);

        QSignalSpy resolved(&f.catalog, &ProjectCatalog::projectResolved);
        f.transport.respondLast(FakeTransport::answer(200, archivedBody));
        QCOMPARE(resolved.count(), 1);
        f.choose(33, true);
        QCOMPARE(f.project.indicator().state, State::Project);
        QCOMPARE(f.project.indicator().color, QStringLiteral("#112233"));
        QCOMPARE(f.project.entryProject()->name, QStringLiteral("Old"));
        // The menu names the archived project only on its entry.
        QCOMPARE(f.project.details(33, true)->name, QStringLiteral("Old"));
        QVERIFY(!f.project.details(33, false));
    }

    void aProjectTheInstanceLacksShowsNoIndicator()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        f.choose(44, true);
        f.transport.respondLast(FakeTransport::answer(404, R"({"error":"Project not found"})"));
        f.choose(44, true);
        QCOMPARE(f.project.indicator().state, State::None);
        // A map without a name, so the menu can tell it is gone.
        QVERIFY(f.project.entryProject());
        QVERIFY(f.project.entryProject()->name.isEmpty());
    }

    void anAnswerForAnotherChoiceIsDropped()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        f.choose(33, true);
        f.choose(11, true);
        QSignalSpy resolved(&f.catalog, &ProjectCatalog::projectResolved);
        f.transport.respondLast(FakeTransport::answer(200, archivedBody));
        QCOMPARE(resolved.count(), 0);
    }

    void withoutAConnectionNothingIsRead()
    {
        Fixture f;
        QVERIFY(f.connectAndList());
        const qsizetype before = f.transport.requests.size();
        f.choose(33, true, nullptr);
        QCOMPARE(f.transport.requests.size(), before);
        QCOMPARE(f.project.indicator().state, State::Pending);
    }
};

QTEST_GUILESS_MAIN(ChosenProjectTest)

#include "chosenprojecttest.moc"
