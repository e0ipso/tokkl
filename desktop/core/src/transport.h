#pragma once

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QUrl>

class QNetworkAccessManager;
class QNetworkRequest;

namespace Tokkl
{

struct HttpRequest {
    QByteArray method; // GET, POST, PUT or PATCH
    QUrl url;
    QByteArray authorization; // full header value; never logged
    QByteArray body; // JSON, empty for none
    // Sent as the Idempotency-Key header when not empty: the same key with
    // the same request makes the server answer what the first one did
    // instead of acting again.
    QByteArray idempotencyKey;
};

struct HttpResponse {
    enum class Outcome {
        Finished, // the server answered; status holds the HTTP status
        NetworkError, // no HTTP answer (refused, unreachable, DNS or TLS failure), a 2xx whose body broke off, or a body over the size limit
        Timeout,
        Aborted,
    };

    Outcome outcome = Outcome::NetworkError;
    int status = 0;
    QByteArray body;
    QByteArray retryAfter; // raw Retry-After header, if any
    QByteArray location; // raw Location header of a redirect, if any
    // The raw Tokkl-Error-Code and Tokkl-Error-Field headers of an error
    // answer, if any: what failed and which field it names, for a client to
    // read without parsing the message. Older servers send neither.
    QByteArray errorCode;
    QByteArray errorField;
    QString errorString; // for NetworkError; holds no credentials
};

// One request in flight. It emits finished() once, then the receiver deletes it.
class PendingReply : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // Stop the request. It still emits finished(), with Outcome::Aborted
    // unless an answer was already delivered.
    virtual void abort() = 0;

Q_SIGNALS:
    void finished(const Tokkl::HttpResponse &response);
};

// A request whose answer is read as it arrives, such as an event stream.
// Each piece of a 2xx body comes in dataReceived(). finished() comes once at
// the end, then the receiver deletes it. For a 2xx answer its body is empty,
// as the data has been delivered; any other answer delivers no data and
// carries its whole body in finished().
class PendingStream : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // Stop the stream. It still emits finished(), with Outcome::Aborted
    // unless the end was already delivered.
    virtual void abort() = 0;

Q_SIGNALS:
    void dataReceived(const QByteArray &data);
    void finished(const Tokkl::HttpResponse &response);
};

// Sends HTTP requests. Tests replace it with a scripted fake.
class Transport : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual PendingReply *send(const HttpRequest &request) = 0;
    // A GET that accepts text/event-stream and reads the answer as it comes.
    virtual PendingStream *openStream(const HttpRequest &request) = 0;
};

struct TransportLimits {
    // How long a request may go without finishing.
    int timeoutMs = 15000;
    // How long a stream may go without a byte, its head included: more than
    // twice the 25 s between the server's keep-alive events.
    int streamIdleTimeoutMs = 60000;
    // A reply's body, or a refused stream's; more ends as a NetworkError.
    // Far above any answer the companions read, it bounds a broken server.
    qint64 maxResponseBytes = 16 * 1024 * 1024;
};

// QNetworkAccessManager without redirects, cookies or caching, with a
// per-request timeout.
class NetworkTransport : public Transport
{
    Q_OBJECT

public:
    // Requests send the User-Agent "<clientName>/<Tokkl version>".
    explicit NetworkTransport(const QString &clientName, QObject *parent = nullptr, const TransportLimits &limits = {});

    PendingReply *send(const HttpRequest &request) override;
    PendingStream *openStream(const HttpRequest &request) override;

private:
    QNetworkRequest networkRequest(const HttpRequest &request, const QByteArray &accept) const;

    QNetworkAccessManager *m_manager;
    QByteArray m_userAgent;
    const TransportLimits m_limits;
};

}
