// The pause chain store the widget creates from QML, against the configuration
// of an applet in a containment of a test corona. The corona writes its
// appletsrc file under the test's own XDG_CONFIG_HOME, and the timer talks to
// the fakes of desktop/core, so no real shell, wallet or network is reached.

#include "appletchainstore.h"
#include "connection.h"
#include "fakes.h"
#include "instanceurl.h"
#include "timercontroller.h"

#include <KConfig>
#include <KConfigGroup>
#include <KSharedConfig>
#include <Plasma/Applet>
#include <Plasma/Containment>
#include <Plasma/Corona>

#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://a.example.test");
const QString token = QStringLiteral("tok-applet-1");

// The smallest shell that can host an applet: one screen and an empty
// containment, which Plasma creates when the requested plugin does not exist.
class TestCorona : public Plasma::Corona
{
public:
    QRect screenGeometry(int) const override
    {
        return QRect(0, 0, 1280, 800);
    }
};

QByteArray meBody(qint64 id, qint64 workspace)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("id"), id},
                             {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                             {QStringLiteral("fullname"), QStringLiteral("Bea")},
                             {QStringLiteral("timezone"), QStringLiteral("UTC")},
                             {QStringLiteral("default_workspace_id"), workspace},
                             {QStringLiteral("beginning_of_week"), 1},
                         })
        .toJson(QJsonDocument::Compact);
}

// A paused chain of the given user of workspace 7, owned the way the timer
// names the owner: the web app's address, the user and the workspace.
PauseChain pausedChain(qint64 userId)
{
    PauseChain chain;
    chain.owner = QStringLiteral("%1/ %2 7").arg(instance).arg(userId);
    chain.seconds = 65;
    chain.description = QStringLiteral("Write the report");
    chain.projectId = 11;
    chain.taskId = 4;
    chain.tags = {QStringLiteral("focus"), QStringLiteral("client")};
    chain.billable = true;
    return chain;
}

// A timer on the fakes, signed in to the instance as the given user of
// workspace 7, with nothing running.
struct Signed {
    FakeTransport transport;
    FakeCredentialStore credentials;
    FakeClock clock;
    Connection connection{&transport, &credentials, testClientName()};
    TimerController timer{&clock};

    bool connect(qint64 userId)
    {
        credentials.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), token);
        timer.setConnection(&connection);
        connection.setInstanceUrl(instance);
        if (!QTest::qWaitFor([&] {
                return transport.requests.size() == 1;
            })) {
            return false;
        }
        transport.respond(0, FakeTransport::answer(200, meBody(userId, 7)));
        for (qsizetype i = 1; i < transport.requests.size(); ++i) {
            const QString path = transport.requests.at(i).url.path();
            transport.respond(i, FakeTransport::answer(200, path.endsWith(QStringLiteral("/current")) ? "null" : "[]"));
        }
        return timer.isConnected();
    }
};
}

class AppletChainStoreTest : public QObject
{
    Q_OBJECT

    std::unique_ptr<TestCorona> m_corona;
    Plasma::Applet *m_applet = nullptr;

    // The chain group as the corona's appletsrc file holds it on disk.
    KConfigGroup storedGroup(KConfig &file) const
    {
        return file.group(QStringLiteral("Containments"))
            .group(QString::number(m_applet->containment()->id()))
            .group(QStringLiteral("Applets"))
            .group(QString::number(m_applet->id()))
            .group(QStringLiteral("Configuration"))
            .group(QStringLiteral("PauseChain"));
    }

    // Each test starts from an empty appletsrc file, so no chain carries over.
    void wipeLayout()
    {
        const KSharedConfigPtr config = m_corona->config();
        for (const QString &group : config->groupList()) {
            config->deleteGroup(group);
        }
        config->sync();
    }

private Q_SLOTS:
    void init()
    {
        m_corona = std::make_unique<TestCorona>();
        wipeLayout();
        Plasma::Containment *containment = m_corona->createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);
        m_applet = containment->createApplet(QStringLiteral("tokkl.test.emptyapplet"));
        QVERIFY(m_applet);
    }

    void cleanup()
    {
        wipeLayout();
        m_applet = nullptr;
        m_corona.reset();
    }

    void keepsTheChainInTheAppletConfig()
    {
        AppletChainStore store;
        store.setApplet(m_applet);
        QVERIFY(!store.load().has_value());

        PauseChain chain = pausedChain(3);
        store.save(chain);
        QCOMPARE(store.load(), chain);
        {
            // Synced to the appletsrc file, so a shell that does not quit
            // cleanly keeps it.
            KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
            const KConfigGroup group = storedGroup(file);
            QVERIFY(group.exists());
            QCOMPARE(group.readEntry("seconds", QString()), QStringLiteral("65"));
            QCOMPARE(group.readEntry("owner", QString()), chain.owner);
        }
        // Next to the settings group, which the chain never touches.
        QVERIFY(!m_applet->config().group(QStringLiteral("General")).hasKey("seconds"));

        // A second store on the same applet, as after a restart.
        AppletChainStore reopened;
        reopened.setApplet(m_applet);
        QCOMPARE(reopened.load(), chain);

        // The running clone, with the absent ids and tags written as such.
        chain.runningId = 6;
        chain.projectId.reset();
        chain.taskId.reset();
        chain.tags.clear();
        chain.billable = false;
        store.save(chain);
        QCOMPARE(reopened.load(), chain);
    }

    void unreadableValuesAreNoChain_data()
    {
        QTest::addColumn<QString>("key");
        QTest::addColumn<QString>("value");
        QTest::newRow("seconds not a number") << "seconds" << "many";
        QTest::newRow("negative seconds") << "seconds" << "-1";
        QTest::newRow("empty owner") << "owner" << "";
        QTest::newRow("zero running id") << "runningId" << "0";
        QTest::newRow("running id not a number") << "runningId" << "six";
        QTest::newRow("negative project id") << "projectId" << "-11";
        QTest::newRow("task id not a number") << "taskId" << "4x";
    }

    void unreadableValuesAreNoChain()
    {
        QFETCH(QString, key);
        QFETCH(QString, value);
        AppletChainStore store;
        store.setApplet(m_applet);
        store.save(pausedChain(3));
        KConfigGroup group = m_applet->config().group(QStringLiteral("PauseChain"));
        group.writeEntry(key, value);
        QVERIFY(!store.load().has_value());
    }

    void savingNoChainDeletesTheGroup()
    {
        AppletChainStore store;
        store.setApplet(m_applet);
        store.save(pausedChain(3));
        store.save(std::nullopt);
        QVERIFY(!store.load().has_value());
        QVERIFY(!m_applet->config().group(QStringLiteral("PauseChain")).exists());
        KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
        QVERIFY(!storedGroup(file).exists());
    }

    void withoutAnAppletNothingIsStored()
    {
        QObject notAnApplet;
        AppletChainStore store;
        store.setApplet(&notAnApplet);
        store.save(pausedChain(3));
        QVERIFY(!store.load().has_value());
        QVERIFY(!m_applet->config().group(QStringLiteral("PauseChain")).exists());

        Signed s;
        store.setTimer(&s.timer);
        QVERIFY(s.timer.chainStore() != &store);
    }

    void handsItselfToTheTimer()
    {
        Signed s;
        {
            AppletChainStore store;
            store.setTimer(&s.timer);
            QVERIFY(s.timer.chainStore() != &store);
            store.setApplet(m_applet);
            QCOMPARE(s.timer.chainStore(), &store);
        }
        // The timer outlives the store as QML tears the widget down.
        QCOMPARE(s.timer.chainStore(), nullptr);
    }

    void timerResumesTheOwnersChain()
    {
        {
            AppletChainStore earlier;
            earlier.setApplet(m_applet);
            earlier.save(pausedChain(3));
        }
        Signed s;
        AppletChainStore store;
        store.setApplet(m_applet);
        store.setTimer(&s.timer);
        QVERIFY(s.connect(3));
        QVERIFY(s.timer.isPaused());
        QCOMPARE(s.timer.elapsedSeconds(), 65);
        QCOMPARE(store.load(), pausedChain(3));
    }

    void anotherOwnersChainIsDeleted()
    {
        {
            AppletChainStore earlier;
            earlier.setApplet(m_applet);
            earlier.save(pausedChain(3));
        }
        Signed s;
        AppletChainStore store;
        store.setApplet(m_applet);
        store.setTimer(&s.timer);
        QVERIFY(s.connect(4));
        QVERIFY(!s.timer.isPaused());
        QCOMPARE(s.timer.elapsedSeconds(), 0);
        QVERIFY(!store.load().has_value());
        KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
        QVERIFY(!storedGroup(file).exists());
    }
};

QTEST_MAIN(AppletChainStoreTest)

#include "appletchainstoretest.moc"
