// The Pomodoro store the widget creates from QML, against the configuration
// of an applet in a containment of a test corona. The corona writes its
// appletsrc file under the test's own XDG_CONFIG_HOME, so no real shell or
// settings are reached.

#include "appletpomodorostore.h"

#include <KConfig>
#include <KConfigGroup>
#include <KSharedConfig>
#include <Plasma/Applet>
#include <Plasma/Containment>
#include <Plasma/Corona>

#include <QTest>

using namespace Tokkl;

namespace
{
// Owners the way the core names them: the instance, the user and the
// workspace. The URL and the spaces must survive as a KConfig key.
const QString ownerA = QStringLiteral("https://a.example.test/ 3 7");
const QString ownerB = QStringLiteral("https://b.example.test/tokkl 4 9");
const QByteArray recordA = QByteArrayLiteral(R"({"version":1,"session":{"id":"s1"}})");
const QByteArray recordB = QByteArrayLiteral(R"({"version":1,"unsaved":[{"id":"u1"}]})");

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
}

class AppletPomodoroStoreTest : public QObject
{
    Q_OBJECT

    std::unique_ptr<TestCorona> m_corona;
    Plasma::Applet *m_applet = nullptr;

    // The Pomodoro group as the corona's appletsrc file holds it on disk.
    KConfigGroup storedGroup(KConfig &file) const
    {
        return file.group(QStringLiteral("Containments"))
            .group(QString::number(m_applet->containment()->id()))
            .group(QStringLiteral("Applets"))
            .group(QString::number(m_applet->id()))
            .group(QStringLiteral("Configuration"))
            .group(QStringLiteral("Pomodoro"));
    }

    // Each test starts from an empty appletsrc file.
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

    void keepsTheModeInTheAppletConfig()
    {
        AppletPomodoroStore store;
        store.setApplet(m_applet);
        QVERIFY(!store.loadPomodoroMode());

        QVERIFY(store.savePomodoroMode(true));
        QVERIFY(store.loadPomodoroMode());
        {
            // Synced to the appletsrc file, so a shell that does not quit
            // cleanly keeps it.
            KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
            const KConfigGroup group = storedGroup(file);
            QVERIFY(group.exists());
            QVERIFY(group.readEntry("mode", false));
        }
        // Outside the settings schema, which the Configure dialog edits.
        QVERIFY(!m_applet->config().group(QStringLiteral("General")).hasKey("mode"));

        // A second store on the same applet, as after a restart.
        AppletPomodoroStore reopened;
        reopened.setApplet(m_applet);
        QVERIFY(reopened.loadPomodoroMode());

        QVERIFY(store.savePomodoroMode(false));
        QVERIFY(!reopened.loadPomodoroMode());
    }

    void keepsOneRecordPerOwner()
    {
        AppletPomodoroStore store;
        store.setApplet(m_applet);
        QVERIFY(store.loadRecord(ownerA).isEmpty());

        QVERIFY(store.saveRecord(ownerA, recordA));
        QVERIFY(store.saveRecord(ownerB, recordB));
        QCOMPARE(store.loadRecord(ownerA), recordA);
        QCOMPARE(store.loadRecord(ownerB), recordB);
        {
            KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
            const KConfigGroup group = storedGroup(file);
            QVERIFY(group.exists());
            // Two records, under keys that do not carry the owner's URL.
            const QStringList keys = group.keyList();
            QCOMPARE(keys.size(), 2);
            for (const QString &key : keys) {
                QVERIFY2(!key.contains(QLatin1Char('/')), qPrintable(key));
                QVERIFY2(!key.contains(QLatin1Char(' ')), qPrintable(key));
            }
        }

        AppletPomodoroStore reopened;
        reopened.setApplet(m_applet);
        QCOMPARE(reopened.loadRecord(ownerA), recordA);

        // A write replaces the owner's record, and an empty one removes it.
        QVERIFY(store.saveRecord(ownerA, recordB));
        QCOMPARE(reopened.loadRecord(ownerA), recordB);
        QVERIFY(store.saveRecord(ownerA, QByteArray()));
        QVERIFY(reopened.loadRecord(ownerA).isEmpty());
        QCOMPARE(reopened.loadRecord(ownerB), recordB);
        KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
        QCOMPARE(storedGroup(file).keyList().size(), 1);
    }

    void withoutAnAppletNothingIsStored()
    {
        QObject notAnApplet;
        AppletPomodoroStore store;
        store.setApplet(&notAnApplet);
        QVERIFY(!store.savePomodoroMode(true));
        QVERIFY(!store.loadPomodoroMode());
        QVERIFY(!store.saveRecord(ownerA, recordA));
        QVERIFY(store.loadRecord(ownerA).isEmpty());
        QVERIFY(!m_applet->config().group(QStringLiteral("Pomodoro")).exists());
    }
};

QTEST_MAIN(AppletPomodoroStoreTest)

#include "appletpomodorostoretest.moc"
