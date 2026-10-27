// NetworkTransport against an in-process HTTP server on the loopback
// interface. No other host is contacted.

#include "transport.h"

#include <QHostAddress>
#include <QPointer>
#include <QSignalSpy>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTest>

#include <optional>

using namespace Tokkl;

namespace
{
// Not the KDE widget's "tokkl-kde", so the User-Agent shows the name is
// passed in.
const QString clientName = QStringLiteral("tokkl-test");

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

// Holds each connection open after the request, so a test writes the
// response a piece at a time.
class StreamServer : public QObject
{
    Q_OBJECT

public:
    StreamServer()
    {
        connect(&m_server, &QTcpServer::newConnection, this, [this] {
            while (QTcpSocket *candidate = m_server.nextPendingConnection()) {
                connect(candidate, &QTcpSocket::readyRead, this, [this, candidate] {
                    m_buffer += candidate->readAll();
                    if (!socket && m_buffer.contains("\r\n\r\n")) {
                        request = m_buffer;
                        socket = candidate;
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

    // One chunk of a chunked body.
    void writeChunk(const QByteArray &data)
    {
        socket->write(QByteArray::number(data.size(), 16) + "\r\n" + data + "\r\n");
        socket->flush();
    }

    QByteArray request;
    QPointer<QTcpSocket> socket; // set once a request has arrived

private:
    QTcpServer m_server;
    QByteArray m_buffer;
};

const QByteArray streamHead = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-store\r\n"
                              "Connection: close\r\nTransfer-Encoding: chunked\r\n\r\n";

// What a stream delivered.
struct StreamLog {
    QByteArray data;
    int chunks = 0;
    QList<HttpResponse> finished;

    explicit StreamLog(PendingStream *stream)
    {
        QObject::connect(stream, &PendingStream::dataReceived, stream, [this](const QByteArray &chunk) {
            data += chunk;
            ++chunks;
        });
        QObject::connect(stream, &PendingStream::finished, stream, [this](const HttpResponse &response) {
            finished.append(response);
        });
    }
};

QByteArray httpResponse(const QByteArray &statusLine, const QByteArray &headers, const QByteArray &body)
{
    return "HTTP/1.1 " + statusLine + "\r\nContent-Type: application/json\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\nConnection: close\r\n"
        + headers + "\r\n" + body;
}

// The header fields of a raw request, by lower-case name. Field names are
// case-insensitive, and Qt 6.8 sends them in lower case.
QHash<QByteArray, QByteArray> headerFields(const QByteArray &request)
{
    QHash<QByteArray, QByteArray> fields;
    const QList<QByteArray> lines = request.left(request.indexOf("\r\n\r\n")).split('\n');
    for (qsizetype i = 1; i < lines.size(); ++i) {
        const qsizetype colon = lines[i].indexOf(':');
        if (colon > 0) {
            fields.insert(lines[i].left(colon).toLower(), lines[i].mid(colon + 1).trimmed());
        }
    }
    return fields;
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
        NetworkTransport transport(clientName);
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/prefix/api/v9/me/time_entries/current")), "Basic dDphcGlfdG9rZW4=", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::Finished);
        QCOMPARE(response.status, 200);
        QCOMPARE(response.body, QByteArray("null"));

        QCOMPARE(server.requests.size(), 1);
        const QByteArray request = server.requests.first();
        QVERIFY(request.startsWith("GET /prefix/api/v9/me/time_entries/current HTTP/1.1\r\n"));
        const QHash<QByteArray, QByteArray> fields = headerFields(request);
        QCOMPARE(fields.value("authorization"), QByteArray("Basic dDphcGlfdG9rZW4="));
        QCOMPARE(fields.value("accept"), QByteArray("application/json"));
        QCOMPARE(fields.value("user-agent"), QByteArray("tokkl-test/" TOKKL_VERSION_STRING));

        // A cookie the server set is not sent back.
        sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        QCOMPARE(server.requests.size(), 2);
        QVERIFY(!headerFields(server.requests.last()).contains("cookie"));
    }

    void jsonBody()
    {
        LoopbackServer server;
        server.response = httpResponse("200 OK", "", "{}");
        NetworkTransport transport(clientName);
        sendAndWait(transport, HttpRequest{"POST", server.url(QStringLiteral("/api/v9/workspaces/7/time_entries")), "Basic eA==", "{\"duration\":-1}"});
        QCOMPARE(server.requests.size(), 1);
        QVERIFY(server.requests.first().startsWith("POST /api/v9/workspaces/7/time_entries "));
        QCOMPARE(headerFields(server.requests.first()).value("content-type"), QByteArray("application/json"));
    }

    void redirectsAreNotFollowed()
    {
        LoopbackServer target;
        target.response = httpResponse("200 OK", "", "{}");
        LoopbackServer server;
        server.response = httpResponse("302 Found", "Location: " + target.url(QStringLiteral("/steal")).toEncoded() + "\r\n", "");
        NetworkTransport transport(clientName);
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
        NetworkTransport transport(clientName);
        const HttpResponse response = sendAndWait(transport, HttpRequest{"GET", server.url(QStringLiteral("/api/v9/me")), "Basic eA==", {}});
        QCOMPARE(response.status, 429);
        QCOMPARE(response.retryAfter, QByteArray("120"));
    }

    void timeout()
    {
        LoopbackServer server; // reads the request, never answers
        NetworkTransport transport(clientName);
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
        NetworkTransport transport(clientName);
        const HttpResponse response =
            sendAndWait(transport, HttpRequest{"GET", QUrl(QStringLiteral("http://127.0.0.1:%1/api/v9/me").arg(port)), "Basic c2VjcmV0", {}});
        QVERIFY(response.outcome == HttpResponse::Outcome::NetworkError);
        QVERIFY(!response.errorString.isEmpty());
        QVERIFY(!response.errorString.contains(QLatin1String("c2VjcmV0")));
    }

    void abort()
    {
        LoopbackServer server;
        NetworkTransport transport(clientName);
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

    // A stream delivers each piece of the body as it arrives, then ends once.
    void streamDeliversChunks()
    {
        StreamServer server;
        NetworkTransport transport(clientName);
        PendingStream *stream = transport.openStream(HttpRequest{"GET", server.url(QStringLiteral("/api/app/timer/events")), "Basic dDphcGlfdG9rZW4=", {}});
        StreamLog log(stream);
        QTRY_VERIFY(server.socket);
        QVERIFY(server.request.startsWith("GET /api/app/timer/events HTTP/1.1\r\n"));
        const QHash<QByteArray, QByteArray> fields = headerFields(server.request);
        QCOMPARE(fields.value("authorization"), QByteArray("Basic dDphcGlfdG9rZW4="));
        QCOMPARE(fields.value("accept"), QByteArray("text/event-stream"));
        QCOMPARE(fields.value("user-agent"), QByteArray("tokkl-test/" TOKKL_VERSION_STRING));

        server.socket->write(streamHead);
        server.writeChunk("event: timer\n");
        QTRY_COMPARE(log.data, QByteArray("event: timer\n"));
        server.writeChunk("data: {}\n\n");
        QTRY_COMPARE(log.data, QByteArray("event: timer\ndata: {}\n\n"));
        QVERIFY(log.chunks >= 2);
        QVERIFY(log.finished.isEmpty());

        // The server ends the stream cleanly.
        server.socket->write("0\r\n\r\n");
        server.socket->disconnectFromHost();
        QTRY_COMPARE(log.finished.size(), 1);
        QVERIFY(log.finished.first().outcome == HttpResponse::Outcome::Finished);
        QCOMPARE(log.finished.first().status, 200);
        QVERIFY(log.finished.first().body.isEmpty());
        delete stream;
    }

    // There is no overall timeout, only one for a silence: each piece of data
    // restarts it.
    void streamIdleTimeout()
    {
        StreamServer server;
        NetworkTransport transport(clientName);
        // More than twice the 25 s between the server's keep-alive comments.
        QCOMPARE(transport.streamIdleTimeout(), 60000);
        transport.setTimeout(100);
        transport.setStreamIdleTimeout(1000);
        PendingStream *stream = transport.openStream(HttpRequest{"GET", server.url(QStringLiteral("/api/app/timer/events")), "Basic eA==", {}});
        StreamLog log(stream);
        QTRY_VERIFY(server.socket);
        server.socket->write(streamHead);
        for (int i = 0; i < 4; ++i) {
            server.writeChunk(": keep-alive\n\n");
            QTest::qWait(300);
        }
        // 1200 ms since the request, more than the request timeout and the
        // idle timeout.
        QVERIFY(log.finished.isEmpty());
        QTRY_COMPARE(log.finished.size(), 1);
        QVERIFY(log.finished.first().outcome == HttpResponse::Outcome::Timeout);
        QCOMPARE(log.data, QByteArray(": keep-alive\n\n").repeated(4));
        delete stream;
    }

    // A refused stream delivers no data; its answer comes with the end.
    void streamRefused()
    {
        LoopbackServer server;
        server.response = httpResponse("403 Forbidden", "", "\"Invalid credentials\"");
        NetworkTransport transport(clientName);
        PendingStream *stream = transport.openStream(HttpRequest{"GET", server.url(QStringLiteral("/api/app/timer/events")), "Basic eA==", {}});
        StreamLog log(stream);
        QTRY_COMPARE(log.finished.size(), 1);
        QVERIFY(log.finished.first().outcome == HttpResponse::Outcome::Finished);
        QCOMPARE(log.finished.first().status, 403);
        QCOMPARE(log.finished.first().body, QByteArray("\"Invalid credentials\""));
        QCOMPARE(log.chunks, 0);
        delete stream;
    }

    void streamAbort()
    {
        StreamServer server;
        NetworkTransport transport(clientName);
        PendingStream *stream = transport.openStream(HttpRequest{"GET", server.url(QStringLiteral("/api/app/timer/events")), "Basic eA==", {}});
        StreamLog log(stream);
        QTRY_VERIFY(server.socket);
        server.socket->write(streamHead);
        server.writeChunk(": keep-alive\n\n");
        QTRY_COMPARE(log.chunks, 1);
        stream->abort();
        QTRY_COMPARE(log.finished.size(), 1);
        QVERIFY(log.finished.first().outcome == HttpResponse::Outcome::Aborted);
        delete stream;
    }
};

QTEST_GUILESS_MAIN(NetworkTransportTest)

#include "networktransporttest.moc"
