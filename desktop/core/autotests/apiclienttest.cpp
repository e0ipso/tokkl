// ApiClient against a scripted session and transport: what it asks the
// session before a request, what it hands back after one, and which answers
// it drops. connectiontest covers the same paths through Connection.

#include "apiclient.h"
#include "clock.h"
#include "fakes.h"

#include <QSignalSpy>
#include <QTest>

#include <memory>

using namespace Tokkl;

namespace
{
// Answers what the test sets and records what the client reports.
class ScriptedSession : public ApiSession
{
public:
    quint64 generation() const override
    {
        return currentGeneration;
    }

    QByteArray authorization() const override
    {
        return QByteArrayLiteral("Basic dGVzdA==");
    }

    std::optional<ApiError> refusal(ApiAccess access) const override
    {
        asked.append(access);
        return refuse;
    }

    void answered() override
    {
        ++answers;
    }

    bool absorbFailure(const HttpResponse &, const ApiError &error, ApiAccess access) override
    {
        failures.append({error.kind, access});
        if (endGenerationOnFailure) {
            ++currentGeneration;
            return false;
        }
        return true;
    }

    const Clock &clock() const override
    {
        return sessionClock;
    }

    quint64 currentGeneration = 1;
    FakeClock sessionClock;
    std::optional<ApiError> refuse;
    bool endGenerationOnFailure = false;
    mutable QList<ApiAccess> asked;
    int answers = 0;
    QList<std::pair<ApiError::Kind, ApiAccess>> failures;
};

std::optional<int> decodeNumber(const QJsonValue &value)
{
    return value.isDouble() ? std::optional<int>(value.toInt()) : std::nullopt;
}

const QUrl testUrl(QStringLiteral("https://tokkl.example/api/v9/thing"));

}

class ApiClientTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void callDecodesASuccessAndTellsTheSession()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<ApiResult<int>> received;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Read, &decodeNumber, [&](const ApiResult<int> &result) {
            received = result;
        });

        QCOMPARE(session.asked, QList<ApiAccess>{ApiAccess::Read});
        QCOMPARE(transport.requests.size(), 1);
        QCOMPARE(transport.requests.first().authorization, QByteArrayLiteral("Basic dGVzdA=="));
        transport.respondLast(FakeTransport::answer(200, "7"));
        QVERIFY(received && received->ok());
        QCOMPARE(*received->value, 7);
        QCOMPARE(session.answers, 1);
        QVERIFY(session.failures.isEmpty());
    }

    void aRefusalSendsNothingAndArrivesLater()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiError refused;
        refused.kind = ApiError::Kind::NotConnected;
        session.refuse = refused;
        ApiClient client(&transport, session);
        std::optional<ApiResult<int>> received;
        client.call<int>("POST", testUrl, "{}", ApiAccess::Write, &decodeNumber, [&](const ApiResult<int> &result) {
            received = result;
        });

        QVERIFY(transport.requests.isEmpty());
        QVERIFY(!received);
        QTRY_VERIFY(received.has_value());
        QCOMPARE(received->error.kind, ApiError::Kind::NotConnected);
    }

    void aRefusalIsDroppedOnceTheGenerationMovesOn()
    {
        FakeTransport transport;
        ScriptedSession session;
        session.refuse = ApiError{ApiError::Kind::NotConnected, 0, QString()};
        ApiClient client(&transport, session);
        bool called = false;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Read, &decodeNumber, [&](const ApiResult<int> &) {
            called = true;
        });
        ++session.currentGeneration;
        QCoreApplication::processEvents();
        QVERIFY(!called);
    }

    void anUnreadableBodyIsAnInvalidResponse()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<ApiResult<int>> received;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Read, &decodeNumber, [&](const ApiResult<int> &result) {
            received = result;
        });
        transport.respondLast(FakeTransport::answer(200, "\"seven\""));
        QVERIFY(received && !received->ok());
        QCOMPARE(received->error.kind, ApiError::Kind::InvalidResponse);
        QCOMPARE(session.answers, 0);
        QVERIFY(session.failures.isEmpty());
    }

    void aFailureGoesToTheSessionWithItsAccess()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<ApiResult<int>> received;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Account, &decodeNumber, [&](const ApiResult<int> &result) {
            received = result;
        });
        transport.respondLast(FakeTransport::answer(503, "\"down\""));
        QCOMPARE(session.failures.size(), 1);
        QCOMPARE(session.failures.first().first, ApiError::Kind::Server);
        QCOMPARE(session.failures.first().second, ApiAccess::Account);
        QVERIFY(received && !received->ok());
        QCOMPARE(received->error.kind, ApiError::Kind::Server);
    }

    void aFailureThatEndsTheGenerationReachesNoCaller()
    {
        FakeTransport transport;
        ScriptedSession session;
        session.endGenerationOnFailure = true;
        ApiClient client(&transport, session);
        bool called = false;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Read, &decodeNumber, [&](const ApiResult<int> &) {
            called = true;
        });
        transport.respondLast(FakeTransport::answer(401, "\"no\""));
        QCOMPARE(session.failures.size(), 1);
        QVERIFY(!called);
    }

    void anAnswerFromAnEarlierGenerationIsDropped()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        bool called = false;
        client.send("GET", testUrl, QByteArray(), [&](const HttpResponse &) {
            called = true;
        });
        ++session.currentGeneration;
        client.abortAll();
        QVERIFY(transport.replies.first()->aborted);
        transport.respondLast(FakeTransport::answer(200, "1"));
        QVERIFY(!called);
    }

    void aConflictCarriesTheServersStateWithoutAFailure()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<TimerActionResult> received;
        client.action(testUrl, "{}", [&](const TimerActionResult &result) {
            received = result;
        });
        QCOMPARE(session.asked, QList<ApiAccess>{ApiAccess::Write});
        QCOMPARE(transport.requests.first().method, QByteArrayLiteral("POST"));
        // Not a timer state: the 409 cannot say what refused the action.
        transport.respondLast(FakeTransport::answer(409, "\"stale\""));
        QVERIFY(received);
        QCOMPARE(received->outcome, TimerActionResult::Outcome::Refused);
        QVERIFY(session.failures.isEmpty());
    }

    void anActionWithoutAnAnswerHasAnUnknownOutcome()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<TimerActionResult> received;
        client.action(testUrl, "{}", [&](const TimerActionResult &result) {
            received = result;
        });
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QVERIFY(received);
        QCOMPARE(received->outcome, TimerActionResult::Outcome::Unknown);
        QCOMPARE(session.failures.size(), 1);
        QCOMPARE(session.failures.first().second, ApiAccess::Write);
    }

    // A keyed action whose outcome is unknown goes out once more after one
    // retry wait, with the same body and key, and the second answer is the
    // one reported. A plain action carries no key and is never sent again.
    void aKeyedActionWithoutAnAnswerGoesOutOnceMore()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        QList<TimerActionResult> received;
        const QByteArray key = ApiClient::newIdempotencyKey();
        client.keyedAction(testUrl, R"({"revision":3})", key, [&](const TimerActionResult &result) {
            received.append(result);
        });
        QCOMPARE(transport.requests.size(), 1);
        QCOMPARE(transport.requests.first().idempotencyKey, key);
        transport.respondLast(FakeTransport::answer(502, "\"Bad gateway\""));
        QVERIFY(received.isEmpty());
        // Not at once: the same failure would likely answer.
        QTest::qWait(retryMinMs / 2);
        QCOMPARE(transport.requests.size(), 1);
        QTRY_COMPARE(transport.requests.size(), 2);
        QCOMPARE(transport.requests.last().body, QByteArray(R"({"revision":3})"));
        QCOMPARE(transport.requests.last().idempotencyKey, key);
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QCOMPARE(received.size(), 1);
        QCOMPARE(received.first().outcome, TimerActionResult::Outcome::Unknown);
        QCOMPARE(transport.requests.size(), 2);

        client.action(testUrl, "{}", [&](const TimerActionResult &result) {
            received.append(result);
        });
        QVERIFY(transport.requests.last().idempotencyKey.isEmpty());
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QCOMPARE(received.size(), 2);
        QCOMPARE(transport.requests.size(), 3);
    }

    // The wait before the second send takes its jitter from the session's
    // clock: at the largest jitter none of several resends goes out before
    // retryMinMs and nearly a quarter more.
    void theResendWaitTakesTheSessionClocksJitter()
    {
        FakeTransport transport;
        ScriptedSession session;
        session.sessionClock.jitter = retryMinMs;
        ApiClient client(&transport, session);
        constexpr int actions = 5;
        for (int i = 0; i < actions; ++i) {
            client.keyedAction(testUrl, "{}", ApiClient::newIdempotencyKey(), {});
            transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        }
        QCOMPARE(retryWaitMs(retryMinMs, session.sessionClock), retryMinMs + retryMinMs / retryJitterDivisor - 1);
        // A timer may fire up to 5 % early.
        QTest::qWait(retryMinMs + retryMinMs / 8);
        QCOMPARE(transport.requests.size(), actions);
        QTRY_COMPARE(transport.requests.size(), 2 * actions);
    }

    // An answer, a refusal or a session that refuses the second send ends
    // a keyed action with what the first one got.
    void aKeyedActionIsSentAgainOnlyForAnUnknownOutcome()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        QList<TimerActionResult> received;
        const auto record = [&](const TimerActionResult &result) {
            received.append(result);
        };
        client.keyedAction(testUrl, "{}", "k1", record);
        transport.respondLast(FakeTransport::answer(400, "\"Invalid\""));
        QCOMPARE(received.last().outcome, TimerActionResult::Outcome::Refused);
        QCOMPARE(transport.requests.size(), 1);

        client.keyedAction(testUrl, "{}", "k2", record);
        transport.respondLast(FakeTransport::answer(409, "\"stale\""));
        QCOMPARE(transport.requests.size(), 2);

        // The failure started a cooldown: the session refuses the second.
        client.keyedAction(testUrl, "{}", "k3", record);
        session.refuse = ApiError{ApiError::Kind::RateLimited, 0, QStringLiteral("wait")};
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QCOMPARE(transport.requests.size(), 3);
        QCOMPARE(received.size(), 3);
        QCOMPARE(received.last().outcome, TimerActionResult::Outcome::Unknown);
    }

    // The wait before the second send ends with the generation or the
    // client: nothing goes out, and done never runs.
    void theResendWaitEndsWithTheGenerationOrTheClient_data()
    {
        QTest::addColumn<bool>("newGeneration");
        QTest::newRow("new generation") << true;
        QTest::newRow("client gone") << false;
    }

    void theResendWaitEndsWithTheGenerationOrTheClient()
    {
        QFETCH(bool, newGeneration);
        FakeTransport transport;
        ScriptedSession session;
        auto client = std::make_unique<ApiClient>(&transport, session);
        bool called = false;
        client->keyedAction(testUrl, "{}", "k1", [&called](const TimerActionResult &) {
            called = true;
        });
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        if (newGeneration) {
            ++session.currentGeneration;
        } else {
            client.reset();
        }
        QTest::qWait(retryWaitMs(retryMinMs, session.sessionClock) + retryMinMs);
        QCOMPARE(transport.requests.size(), 1);
        QVERIFY(!called);
    }

    // The session may refuse by the time the wait ends, as during a
    // cooldown: the first answer is reported.
    void aRefusalAfterTheWaitReportsTheFirstAnswer()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        std::optional<TimerActionResult> received;
        client.keyedAction(testUrl, "{}", "k1", [&received](const TimerActionResult &result) {
            received = result;
        });
        transport.respondLast(FakeTransport::failure(HttpResponse::Outcome::Timeout));
        QVERIFY(!received);
        session.refuse = ApiError{ApiError::Kind::RateLimited, 0, QStringLiteral("wait")};
        QTRY_VERIFY(received.has_value());
        QCOMPARE(received->outcome, TimerActionResult::Outcome::Unknown);
        QCOMPARE(transport.requests.size(), 1);
    }

    // One retry wait: retryMinMs plus up to a quarter more from the clock's
    // jitter, the same rule as the state client's reconnect.
    void theRetryWaitAddsUpToAQuarter()
    {
        FakeClock clock;
        QCOMPARE(retryWaitMs(1000, clock), 1000);
        clock.jitter = 249;
        QCOMPARE(retryWaitMs(1000, clock), 1249);
        clock.jitter = 5000;
        QCOMPARE(retryWaitMs(1000, clock), 1249);
        // The system clock's jitter stays below the bound too.
        const SystemClock system;
        for (int i = 0; i < 20; ++i) {
            const int wait = retryWaitMs(retryMinMs, system);
            QVERIFY(wait >= retryMinMs && wait < retryMinMs + retryMinMs / retryJitterDivisor);
        }
    }

    void newIdempotencyKeysAreDistinctHex()
    {
        const QByteArray key = ApiClient::newIdempotencyKey();
        QCOMPARE(key.size(), 32);
        for (const char c : key) {
            QVERIFY((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));
        }
        QVERIFY(ApiClient::newIdempotencyKey() != key);
    }

    void aStreamRefusalGoesToTheSessionAsAnAccountFailure()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        PendingStream *stream = client.openStream(testUrl);
        QVERIFY(stream);
        QCOMPARE(session.asked, QList<ApiAccess>{ApiAccess::Read});
        transport.lastStream()->end(FakeTransport::answer(403, "\"no\""));
        QCOMPARE(session.failures.size(), 1);
        QCOMPARE(session.failures.first().first, ApiError::Kind::Forbidden);
        QCOMPARE(session.failures.first().second, ApiAccess::Account);
    }

    // A 503 that says when to come back is the session's to wait out.
    void aStreamUnavailableWithRetryAfterGoesToTheSession()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        QVERIFY(client.openStream(testUrl));
        transport.lastStream()->end(FakeTransport::answer(503, "\"busy\"", "30"));
        QCOMPARE(session.failures.size(), 1);
        QCOMPARE(session.failures.first().first, ApiError::Kind::Server);
        QCOMPARE(session.failures.first().second, ApiAccess::Account);
    }

    void aStreamThatEndsOtherwiseChangesNothing()
    {
        FakeTransport transport;
        ScriptedSession session;
        ApiClient client(&transport, session);
        QVERIFY(client.openStream(testUrl));
        transport.lastStream()->end(FakeTransport::answer(503, "\"down\""));
        QVERIFY(session.failures.isEmpty());
    }

    void aRefusedReadOpensNoStream()
    {
        FakeTransport transport;
        ScriptedSession session;
        session.refuse = ApiError{ApiError::Kind::RateLimited, 0, QString()};
        ApiClient client(&transport, session);
        QCOMPARE(client.openStream(testUrl), nullptr);
        QVERIFY(transport.streamRequests.isEmpty());
    }

    void withoutATransportARequestFailsLikeOneWithoutNetwork()
    {
        ScriptedSession session;
        ApiClient client(nullptr, session);
        std::optional<ApiResult<int>> received;
        client.call<int>("GET", testUrl, QByteArray(), ApiAccess::Read, &decodeNumber, [&](const ApiResult<int> &result) {
            received = result;
        });
        QTRY_VERIFY(received.has_value());
        QCOMPARE(received->error.kind, ApiError::Kind::Network);
        QCOMPARE(session.failures.size(), 1);
    }
};

QTEST_GUILESS_MAIN(ApiClientTest)

#include "apiclienttest.moc"
