// The timer's objects as every companion builds them, on the fakes: one
// state client and one clock for the timer and the Pomodoro session, and
// the mode in the store given.

#include "fakes.h"
#include "pomodorostore.h"
#include "timerstack.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;

namespace
{
const QString instance = QStringLiteral("https://a.example.test");

// The requests whose path ends with the suffix.
QList<qsizetype> find(const FakeTransport &transport, const QByteArray &method, const QString &suffix)
{
    QList<qsizetype> found;
    for (qsizetype i = 0; i < transport.requests.size(); ++i) {
        if (transport.requests.at(i).method == method && transport.requests.at(i).url.path().endsWith(suffix)) {
            found.append(i);
        }
    }
    return found;
}

// A state with nothing running, built at the given time.
QByteArray idleState(const QDateTime &now)
{
    return QJsonDocument(QJsonObject{
                             {QStringLiteral("revision"), 1},
                             {QStringLiteral("server_time"), now.toString(Qt::ISODateWithMs)},
                             {QStringLiteral("running_entry"), QJsonValue::Null},
                             {QStringLiteral("pause"), QJsonValue::Null},
                             {QStringLiteral("pomodoro"), QJsonValue::Null},
                             {QStringLiteral("discarded_pomodoro"), QJsonValue::Null},
                         })
        .toJson(QJsonDocument::Compact);
}
}

class TimerStackTest : public QObject
{
    Q_OBJECT

    struct Fixture {
        QTemporaryDir dir;
        QSettings settings{dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
        SettingsPomodoroStore pomodoroStore{&settings};
        FakeTransport transport;
        FakeCredentialStore credentials;
        FakeClock clock;
        TimerStack stack{&transport, &credentials, pomodoroStore, clock, testClientName()};

        Fixture()
        {
            transport.status = FakeTransport::currentStatus();
        }

        // Stores a token and points the connection at the instance.
        void configure()
        {
            credentials.secrets.insert(credentialKey(parseInstanceUrl(instance), AuthMode::Token, QString()), QStringLiteral("tok"));
            stack.connection()->setInstanceUrl(instance);
        }
    };

private Q_SLOTS:
    // The timer reads one client on the stack's connection, and the session
    // acts through that client, so both see one state.
    void theTimerAndTheSessionShareOneClient()
    {
        Fixture f;
        TimerStateClient *client = f.stack.timer()->stateClient();
        QVERIFY(client);
        QCOMPARE(client->connection(), f.stack.connection());
        QCOMPARE(&client->clock(), &f.clock);
        QCOMPARE(f.stack.timer()->connection(), f.stack.connection());

        QVERIFY(f.stack.session()->setPomodoroMode(true));
        f.configure();
        QTRY_COMPARE(find(f.transport, "GET", QStringLiteral("/me")).size(), 1);
        f.transport.respond(find(f.transport, "GET", QStringLiteral("/me")).first(), FakeTransport::answer(200, meBody()));
        QVERIFY(f.stack.connection()->isConnected());
        // One read of the state, by the one client. The timer and the
        // session both show it.
        const QList<qsizetype> reads = find(f.transport, "GET", QStringLiteral("/app/timer"));
        QCOMPARE(reads.size(), 1);
        f.transport.respond(reads.first(), FakeTransport::answer(200, idleState(f.clock.now())));
        QVERIFY(f.stack.timer()->canWrite());
        QVERIFY(f.stack.session()->canStartSession());
    }

    // The session keeps its mode in the store given.
    void theSessionKeepsItsModeInTheStore()
    {
        Fixture f;
        QVERIFY(!f.stack.session()->pomodoroMode());
        QVERIFY(f.stack.session()->setPomodoroMode(true));
        QVERIFY(f.pomodoroStore.loadPomodoroMode());
    }
};

QTEST_MAIN(TimerStackTest)

#include "timerstacktest.moc"
