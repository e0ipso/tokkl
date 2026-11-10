#include "appletpomodorostore.h"
#include "kdetimerstate.h"
#include "testcorona.h"

#include <KConfigGroup>
#include <KSharedConfig>
#include <Plasma/Applet>
#include <Plasma/Containment>

#include <QSignalSpy>
#include <QTest>

#include <memory>

using namespace Tokkl;

class KdeTimerStateTest : public QObject
{
    Q_OBJECT

    std::unique_ptr<TestCorona> m_corona;
    Plasma::Applet *m_applet = nullptr;

private Q_SLOTS:
    void init()
    {
        m_corona = std::make_unique<TestCorona>();
        const KSharedConfigPtr config = m_corona->config();
        for (const QString &group : config->groupList()) {
            config->deleteGroup(group);
        }
        config->sync();
        Plasma::Containment *containment = m_corona->createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);
        m_applet = containment->createApplet(QStringLiteral("tokkl.test.emptyapplet"));
        QVERIFY(m_applet);
    }

    void cleanup()
    {
        m_applet = nullptr;
        m_corona.reset();
    }

    void buildsEveryPartAtOnce()
    {
        KdeTimerState state;
        QVERIFY(state.connection());
        QVERIFY(state.timer());
        QVERIFY(state.session());
        QVERIFY(state.preferences());
        QVERIFY(state.timer()->stateClient());
        QCOMPARE(state.timer()->stateClient()->connection(), state.connection());
        QCOMPARE(state.timer()->connection(), state.connection());
        QCOMPARE(state.connection()->state(), Connection::Unconfigured);
    }

    void readsTheModeOnceTheAppletIsSet()
    {
        AppletPomodoroStore saved;
        saved.setApplet(m_applet);
        QVERIFY(saved.savePomodoroMode(true));

        KdeTimerState state;
        QSignalSpy appletChanged(&state, &KdeTimerState::appletChanged);
        QSignalSpy modeChanged(state.session(), &PomodoroSession::modeChanged);
        QVERIFY(!state.session()->pomodoroMode());

        state.setApplet(m_applet);
        QCOMPARE(state.applet(), m_applet);
        QCOMPARE(appletChanged.size(), 1);
        QVERIFY(state.session()->pomodoroMode());
        QCOMPARE(modeChanged.size(), 1);

        QVERIFY(state.session()->setPomodoroMode(false));
        QVERIFY(!saved.loadPomodoroMode());
    }
};

QTEST_MAIN(KdeTimerStateTest)

#include "kdetimerstatetest.moc"
