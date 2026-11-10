#include "appletpomodorostore.h"
#include "testcorona.h"

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
const QString oldRecordKey = QStringLiteral("record-0a1b2c3d4e5f60718293a4b5c6d7e8f901234567");
const QString oldRecord = QStringLiteral(R"({"version":1,"session":{"id":"s1"}})");
}

class AppletPomodoroStoreTest : public QObject
{
    Q_OBJECT

    std::unique_ptr<TestCorona> m_corona;
    Plasma::Applet *m_applet = nullptr;

    KConfigGroup storedGroup(KConfig &file) const
    {
        return file.group(QStringLiteral("Containments"))
            .group(QString::number(m_applet->containment()->id()))
            .group(QStringLiteral("Applets"))
            .group(QString::number(m_applet->id()))
            .group(QStringLiteral("Configuration"))
            .group(QStringLiteral("Pomodoro"));
    }

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
            KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
            const KConfigGroup group = storedGroup(file);
            QVERIFY(group.exists());
            QVERIFY(group.readEntry("mode", false));
        }
        QVERIFY(!m_applet->config().group(QStringLiteral("General")).hasKey("mode"));

        AppletPomodoroStore reopened;
        reopened.setApplet(m_applet);
        QVERIFY(reopened.loadPomodoroMode());

        QVERIFY(store.savePomodoroMode(false));
        QVERIFY(!reopened.loadPomodoroMode());
    }

    void leavesRecordsOfEarlierVersionsAlone()
    {
        m_applet->config().group(QStringLiteral("Pomodoro")).writeEntry(oldRecordKey, oldRecord);
        m_applet->config().sync();

        AppletPomodoroStore store;
        store.setApplet(m_applet);
        QVERIFY2(!store.loadPomodoroMode(), "a record is not the mode");
        QVERIFY(store.savePomodoroMode(true));
        QVERIFY(store.loadPomodoroMode());

        KConfig file(m_corona->config()->name(), KConfig::SimpleConfig);
        const KConfigGroup group = storedGroup(file);
        QCOMPARE(group.readEntry(oldRecordKey, QString()), oldRecord);
        QVERIFY(group.readEntry("mode", false));
        QCOMPARE(group.keyList().size(), 2);
    }

    void withoutAnAppletNothingIsStored()
    {
        QObject notAnApplet;
        AppletPomodoroStore store;
        store.setApplet(&notAnApplet);
        QVERIFY(!store.savePomodoroMode(true));
        QVERIFY(!store.loadPomodoroMode());
        QVERIFY(!m_applet->config().group(QStringLiteral("Pomodoro")).exists());
    }
};

QTEST_MAIN(AppletPomodoroStoreTest)

#include "appletpomodorostoretest.moc"
