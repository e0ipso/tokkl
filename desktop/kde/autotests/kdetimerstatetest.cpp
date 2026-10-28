// The timer state client the widget creates from QML: it is built once the
// connection is set, reads the state through that connection, and is
// replaced, never left dangling, when the connection changes. Everything
// runs on the fakes of desktop/core.

#include "fakes.h"
#include "kdetimerstate.h"

#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://a.example.test");

QByteArray meBody()
{
    return QByteArrayLiteral(
        R"({"id":3,"email":"bea@example.test","fullname":"Bea","timezone":"UTC","default_workspace_id":7,"beginning_of_week":1})");
}

qsizetype stateReads(const FakeTransport &transport)
{
    qsizetype reads = 0;
    for (const HttpRequest &request : transport.requests) {
        if (request.method == "GET" && request.url.path().endsWith(QLatin1String("/app/timer"))) {
            ++reads;
        }
    }
    return reads;
}
}

class KdeTimerStateTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        FakeTransport transport;
        FakeCredentialStore credentials;
        Connection connection{&transport, &credentials, testClientName()};
    };

private Q_SLOTS:
    void buildsTheClientOnceTheConnectionIsSet()
    {
        Fixture f;
        KdeTimerState state;
        QSignalSpy changed(&state, &KdeTimerState::clientChanged);
        QCOMPARE(state.client(), nullptr);

        state.setConnection(&f.connection);
        QVERIFY(state.client());
        QCOMPARE(state.client()->connection(), &f.connection);
        QCOMPARE(state.connection(), &f.connection);
        QCOMPARE(changed.size(), 1);

        // The same connection again changes nothing.
        TimerStateClient *client = state.client();
        state.setConnection(&f.connection);
        QCOMPARE(state.client(), client);
        QCOMPARE(changed.size(), 1);
    }

    void readsTheStateOnceTheAccountIsValid()
    {
        Fixture f;
        KdeTimerState state;
        state.setConnection(&f.connection);
        QCOMPARE(stateReads(f.transport), 0);

        f.credentials.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), QStringLiteral("tok-1"));
        f.connection.setInstanceUrl(instance);
        QVERIFY(QTest::qWaitFor([&] {
            return !f.transport.requests.isEmpty();
        }));
        f.transport.respond(0, FakeTransport::answer(200, meBody()));
        QCOMPARE(stateReads(f.transport), 1);
    }

    void aNewConnectionReplacesTheClient()
    {
        Fixture first;
        Fixture second;
        KdeTimerState state;
        state.setConnection(&first.connection);
        QPointer<TimerStateClient> old = state.client();
        QSignalSpy changed(&state, &KdeTimerState::clientChanged);

        // A listener of the signal already sees the new client, and the old
        // one is still alive while it runs.
        bool oldAliveInSlot = false;
        TimerStateClient *seen = nullptr;
        connect(&state, &KdeTimerState::clientChanged, this, [&] {
            oldAliveInSlot = !old.isNull();
            seen = state.client();
        });
        state.setConnection(&second.connection);
        QCOMPARE(changed.size(), 1);
        QVERIFY(oldAliveInSlot);
        QVERIFY(seen);
        QCOMPARE(seen->connection(), &second.connection);
        QVERIFY(old.isNull());

        state.setConnection(nullptr);
        QCOMPARE(state.client(), nullptr);
        QCOMPARE(changed.size(), 2);
    }

    void theClientGoesWithTheState()
    {
        Fixture f;
        QPointer<TimerStateClient> client;
        {
            KdeTimerState state;
            state.setConnection(&f.connection);
            client = state.client();
            QVERIFY(client);
        }
        QVERIFY(client.isNull());
    }
};

QTEST_MAIN(KdeTimerStateTest)

#include "kdetimerstatetest.moc"
