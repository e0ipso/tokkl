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
    // The same key with the same request makes the server replay its first
    // answer instead of acting again.
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
    // Older servers send neither.
    QByteArray errorCode;
    QByteArray errorField;
    QString errorString; // for NetworkError; holds no credentials
};

// Emits finished() once, then the receiver deletes it.
class PendingReply : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // Still emits finished(), with Outcome::Aborted unless an answer was already
    // delivered.
    virtual void abort() = 0;

Q_SIGNALS:
    void finished(const Tokkl::HttpResponse &response);
};

// A 2xx body arrives in dataReceived() and finished() carries an empty body;
// any other answer delivers no data and its whole body in finished().
class PendingStream : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // Still emits finished(), with Outcome::Aborted unless the end was already
    // delivered.
    virtual void abort() = 0;

Q_SIGNALS:
    void dataReceived(const QByteArray &data);
    void finished(const Tokkl::HttpResponse &response);
};

class Transport : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual PendingReply *send(const HttpRequest &request) = 0;
    virtual PendingStream *openStream(const HttpRequest &request) = 0;
};

struct TransportLimits {
    int timeoutMs = 15000;
    // Idle limit, head included: more than twice the server's 25 s keep-alive.
    int streamIdleTimeoutMs = 60000;
    // More ends as a NetworkError; it bounds a broken server.
    qint64 maxResponseBytes = 16 * 1024 * 1024;
};

// No redirects, cookies or caching.
class NetworkTransport : public Transport
{
    Q_OBJECT

public:
    // User-Agent is "<clientName>/<Tokkl version>".
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
