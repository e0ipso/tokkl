// NetworkTransport against an in-process HTTP server on the loopback
// interface. No other host is contacted.

#include "transport.h"

#include <QHostAddress>
#include <QSignalSpy>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTest>

#include <optional>

using namespace Tokkl;

namespace
{
// Answers each request with a canned response, or not at all.
class LoopbackServer : public QObject
{
    Q_OBJECT

public:
    LoopbackServer()
    {
        connect(&m_server, &QTcpServer::newConnection, this, [this] {
            while (QTcpSocket *socket = m_server.nextPendingConnection()) {
                connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
                    m_buffer[socket] += socket->readAll();
                    if (!m_buffer[socket].contains("\r\n\r\n")) {
                        return;
                    }
                    requests.append(m_buffer.take(socket));
                    if (!response.isEmpty()) {
                        socket->write(response);
                        socket->disconnectFromHost();
                    }
                });
            }
        });
        m_server.listen(QHostAddress::LocalHost);
    }

    QUrl url(const QString &path) const
    {
        return QUrl(QStringLiteral("http://127.0.0.1:%1%2").arg(m_server.serverPort()).arg(path));
    }

    QByteArray response; // empty: never answer
    QList<QByteArray> requests;

private:
    QTcpServer m_server;
    QHash<QTcpSocket *, QByteArray> m_buffer;
};

QByteArray httpResponse(const QByteArray &statusLine, const QByteArray &headers, const QByteArray &body)
{
    return "HTTP/1.1 " + statusLine + "\r\nContent-Type: application/json\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\nConnection: close\r\n"
        + headers + "\r\n" + body;
}

HttpResponse sendAndWait(NetworkTransport &transport, const HttpRequest &request)
{
    std::optional<HttpResponse> result;
    PendingReply *reply = transport.send(request);
    QObject::connect(reply, &PendingReply::finished, reply, [&result, reply](const HttpResponse &response) {
        result = response;
        reply->deleteLater();
    });
    if (!QTest::qWaitFor(
            [&] {
                return result.has_value();
            },
            10000)) {
        qWarning("no response within 10 seconds");
    }
    return result.value_or(HttpResponse());
}
}

class NetworkTransportTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void answersAndHeaders()
    {
        LoopbackServer server;
        server.response = httpResponse("200 OK", "Set-Cookie: tokkl_session=abc\r\n", "null");
        NetworkTransport transport;
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/prefix/api/v9/me/time_entries/current")), "Basic dDphcGlfdG9rZW4=", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::Finished);
        QCOMPARE(response.status, 200);
        QCOMPARE(response.body, QByteArray("null"));

        QCOMPARE(server.requests.size(), 1);
        const QByteArray request = server.requests.first();
        QVERIFY(request.startsWith("GET /prefix/api/v9/me/time_entries/current HTTP/1.1\r\n"));
        QVERIFY(request.contains("\r\nAuthorization: Basic dDphcGlfdG9rZW4=\r\n"));
        QVERIFY(request.contains("\r\nAccept: application/json\r\n"));

        // A cookie the server set is not sent back.
        sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        QCOMPARE(server.requests.size(), 2);
        QVERIFY(!server.requests.last().contains("Cookie:"));
    }

    void jsonBody()
    {
        LoopbackServer server;
        server.response = httpResponse("200 OK", "", "{}");
        NetworkTransport transport;
        sendAndWait(transport, HttpRequest{"POST", server.url(QStringLiteral("/api/v9/workspaces/7/time_entries")), "Basic eA==", "{\"duration\":-1}"});
        QCOMPARE(server.requests.size(), 1);
        QVERIFY(server.requests.first().startsWith("POST /api/v9/workspaces/7/time_entries "));
        QVERIFY(server.requests.first().contains("\r\nContent-Type: application/json\r\n"));
    }

    void redirectsAreNotFollowed()
    {
        LoopbackServer target;
        target.response = httpResponse("200 OK", "", "{}");
        LoopbackServer server;
        server.response = httpResponse("302 Found", "Location: " + target.url(QStringLiteral("/steal")).toEncoded() + "\r\n", "");
        NetworkTransport transport;
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic c2VjcmV0", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::Finished);
        QCOMPARE(response.status, 302);
        QCOMPARE(response.location, target.url(QStringLiteral("/steal")).toEncoded());
        QTest::qWait(100);
        // The credentials never reached the redirect target.
        QVERIFY(target.requests.isEmpty());
    }

    void retryAfterIsRead()
    {
        LoopbackServer server;
        server.response = httpResponse("429 Too Many Requests", "Retry-After: 120\r\n", "\"Too many failed login attempts, try again later\"");
        NetworkTransport transport;
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        QCOMPARE(response.status, 429);
        QCOMPARE(response.retryAfter, QByteArray("120"));
    }

    void timeout()
    {
        LoopbackServer server; // reads the request, never answers
        NetworkTransport transport;
        transport.setTimeout(300);
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::Timeout);
        QCOMPARE(server.requests.size(), 1);
    }

    void connectionRefused()
    {
        quint16 port = 0;
        {
            QTcpServer probe;
            QVERIFY(probe.listen(QHostAddress::LocalHost));
            port = probe.serverPort();
        }
        NetworkTransport transport;
        const HttpResponse response =
            sendAndWait(transport, HttpRequest{"GET", QUrl(QStringLiteral("http://127.0.0.1:%1/api/v9/me").arg(port)), "Basic c2VjcmV0", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::NetworkError);
        QVERIFY(!response.errorString.isEmpty());
        QVERIFY(!response.errorString.contains(QLatin1String("c2VjcmV0")));
    }

    void abort()
    {
        LoopbackServer server;
        NetworkTransport transport;
        std::optional<HttpResponse> result;
        PendingReply *reply = transport.send(HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        connect(reply, &PendingReply::finished, reply, [&result](const HttpResponse &response) {
            result = response;
        });
        QTRY_COMPARE(server.requests.size(), 1);
        reply->abort();
        QTRY_VERIFY(result.has_value());
        QVERIFY(result->outcome == HttpResponse::Outcome::Aborted);
        delete reply;
    }
};

QTEST_GUILESS_MAIN(NetworkTransportTest)

#include "networktransporttest.moc"
