#pragma once

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QUrl>

class QNetworkAccessManager;

namespace Tokkl
{

struct HttpRequest {
    QByteArray method; // GET, POST, PUT or PATCH
    QUrl url;
    QByteArray authorization; // full header value; never logged
    QByteArray body; // JSON, empty for none
};

struct HttpResponse {
    enum class Outcome {
        Finished, // the server answered; status holds the HTTP status
        NetworkError, // no HTTP answer: refused, unreachable, DNS or TLS failure
        Timeout,
        Aborted,
    };

    Outcome outcome = Outcome::NetworkError;
    int status = 0;
    QByteArray body;
    QByteArray retryAfter; // raw Retry-After header, if any
    QByteArray location; // raw Location header of a redirect, if any
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

// Sends HTTP requests. Tests replace it with a scripted fake.
class Transport : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual PendingReply *send(const HttpRequest &request) = 0;
};

// QNetworkAccessManager without redirects, cookies or caching, with a
// per-request timeout.
class NetworkTransport : public Transport
{
    Q_OBJECT

public:
    // Requests send the User-Agent "<clientName>/<Tokkl version>".
    explicit NetworkTransport(const QString &clientName, QObject *parent = nullptr);

    PendingReply *send(const HttpRequest &request) override;

    // How long a request may go without finishing. 15 seconds by default.
    int timeout() const;
    void setTimeout(int ms);

private:
    QNetworkAccessManager *m_manager;
    QByteArray m_userAgent;
    int m_timeoutMs = 15000;
};

}
