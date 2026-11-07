// ApiClient against a scripted session and transport: what it asks the
// session before a request, what it hands back after one, and which answers
// it drops. connectiontest covers the same paths through AuthSession.

#include "apiclient.h"
#include "fakes.h"

#include <QSignalSpy>
#include <QTest>

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

    quint64 currentGeneration = 1;
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
