#include "transport.h"

#include "logging.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

#include <utility>

namespace Tokkl
{

namespace
{
// The URL as a log line may show it: no user info, no query.
QString loggable(const QUrl &url)
{
    return url.toDisplayString(QUrl::RemoveUserInfo | QUrl::RemoveQuery | QUrl::RemoveFragment);
}

void logResponse(const QByteArray &method, const QUrl &url, const HttpResponse &response)
{
    switch (response.outcome) {
    case HttpResponse::Outcome::Finished:
        qCDebug(lcNet) << method << loggable(url) << "answered" << response.status;
        break;
    case HttpResponse::Outcome::NetworkError:
        qCDebug(lcNet) << method << loggable(url) << "failed:" << response.errorString;
        break;
    case HttpResponse::Outcome::Timeout:
        qCDebug(lcNet) << method << loggable(url) << "timed out";
        break;
    case HttpResponse::Outcome::Aborted:
        qCDebug(lcNet) << method << loggable(url) << "aborted";
        break;
    }
}

void readHeaders(const QNetworkReply *reply, HttpResponse &response)
{
    response.retryAfter = reply->rawHeader("Retry-After");
    response.location = reply->rawHeader("Location");
    response.errorCode = reply->rawHeader("Tokkl-Error-Code");
    response.errorField = reply->rawHeader("Tokkl-Error-Field");
}

// Reads a body as it arrives and stops at a size limit, so an answer larger
// than the limit is never held whole.
class BoundedBody
{
public:
    explicit BoundedBody(qint64 limit)
        : m_limit(limit)
    {
    }

    // Reads what the reply has. False once the body, or the length the
    // answer announced, is over the limit; the caller aborts the reply.
    bool read(QNetworkReply *reply)
    {
        if (m_tooLarge) {
            return false;
        }
        const QVariant announced = reply->header(QNetworkRequest::ContentLengthHeader);
        if (announced.isValid() && announced.toLongLong() > m_limit) {
            return fail();
        }
        const qint64 room = m_limit - m_body.size();
        if (reply->bytesAvailable() > room) {
            return fail();
        }
        m_body += reply->readAll();
        return true;
    }

    QByteArray take()
    {
        return std::exchange(m_body, QByteArray());
    }

    QString errorString() const
    {
        return QStringLiteral("the answer is larger than %1 bytes").arg(m_limit);
    }

private:
    bool fail()
    {
        m_tooLarge = true;
        m_body.clear();
        return false;
    }

    qint64 m_limit;
    QByteArray m_body;
    bool m_tooLarge = false;
};

class NetworkReply : public PendingReply
{
    Q_OBJECT

public:
    NetworkReply(const QByteArray &method, QNetworkReply *reply, int timeoutMs, qint64 maxBytes, QObject *parent)
        : PendingReply(parent)
        , m_method(method)
        , m_reply(reply)
        , m_body(maxBytes)
    {
        reply->setParent(this);
        m_timer.setSingleShot(true);
        connect(&m_timer, &QTimer::timeout, this, [this] {
            m_timedOut = true;
            m_reply->abort();
        });
        connect(reply, &QNetworkReply::metaDataChanged, this, &NetworkReply::onReadyRead);
        connect(reply, &QNetworkReply::readyRead, this, &NetworkReply::onReadyRead);
        connect(reply, &QNetworkReply::finished, this, &NetworkReply::onFinished);
        m_timer.start(timeoutMs);
    }

    void abort() override
    {
        m_aborted = true;
        m_reply->abort();
    }

private:
    void onReadyRead()
    {
        if (!m_body.read(m_reply)) {
            m_reply->abort();
        }
    }

    void onFinished()
    {
        m_timer.stop();
        const bool fits = m_body.read(m_reply);
        HttpResponse response;
        const QVariant status = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute);
        if (m_aborted) {
            response.outcome = HttpResponse::Outcome::Aborted;
        } else if (m_timedOut) {
            response.outcome = HttpResponse::Outcome::Timeout;
        } else if (!fits) {
            // Not an answer Tokkl reads. For a write the outcome is unknown,
            // as for a body that broke off.
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_body.errorString();
        } else if (status.isValid() && status.toInt() >= 200 && status.toInt() < 300 && m_reply->error() != QNetworkReply::NoError) {
            // A broken-off 2xx body may still decode as a prefix. Error
            // statuses keep their HTTP meaning; Qt reports those as errors too.
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        } else if (status.isValid() && status.toInt() > 0) {
            response.outcome = HttpResponse::Outcome::Finished;
            response.status = status.toInt();
            response.body = m_body.take();
            readHeaders(m_reply, response);
        } else {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        }
        logResponse(m_method, m_reply->url(), response);
        Q_EMIT finished(response);
    }

    QByteArray m_method;
    QNetworkReply *m_reply;
    BoundedBody m_body;
    QTimer m_timer;
    bool m_timedOut = false;
    bool m_aborted = false;
};

class NetworkStream : public PendingStream
{
    Q_OBJECT

public:
    NetworkStream(QNetworkReply *reply, int idleTimeoutMs, qint64 maxBytes, QObject *parent)
        : PendingStream(parent)
        , m_reply(reply)
        , m_body(maxBytes)
    {
        reply->setParent(this);
        m_idle.setSingleShot(true);
        m_idle.setInterval(idleTimeoutMs);
        connect(&m_idle, &QTimer::timeout, this, [this] {
            m_timedOut = true;
            m_reply->abort();
        });
        connect(reply, &QNetworkReply::metaDataChanged, &m_idle, qOverload<>(&QTimer::start));
        connect(reply, &QNetworkReply::readyRead, this, &NetworkStream::onReadyRead);
        connect(reply, &QNetworkReply::finished, this, &NetworkStream::onFinished);
        m_idle.start();
    }

    void abort() override
    {
        m_aborted = true;
        m_reply->abort();
    }

private:
    int status() const
    {
        const QVariant status = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute);
        return status.isValid() ? status.toInt() : 0;
    }

    bool streaming() const
    {
        return status() >= 200 && status() < 300;
    }

    void onReadyRead()
    {
        m_idle.start();
        // Any other answer keeps its body, within the limit, for finished().
        if (streaming()) {
            const QByteArray data = m_reply->readAll();
            if (!data.isEmpty()) {
                Q_EMIT dataReceived(data);
            }
        } else if (status() > 0 && !m_body.read(m_reply)) {
            m_reply->abort();
        }
    }

    void onFinished()
    {
        m_idle.stop();
        const bool fits = streaming() || status() <= 0 || m_body.read(m_reply);
        HttpResponse response;
        if (m_aborted) {
            response.outcome = HttpResponse::Outcome::Aborted;
        } else if (m_timedOut) {
            response.outcome = HttpResponse::Outcome::Timeout;
        } else if (!fits) {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_body.errorString();
        } else if (streaming() && m_reply->error() != QNetworkReply::NoError) {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        } else if (status() > 0) {
            if (streaming()) {
                onReadyRead();
            } else {
                response.body = m_body.take();
            }
            response.outcome = HttpResponse::Outcome::Finished;
            response.status = status();
            readHeaders(m_reply, response);
        } else {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        }
        logResponse(QByteArrayLiteral("GET stream"), m_reply->url(), response);
        Q_EMIT finished(response);
    }

    QNetworkReply *m_reply;
    BoundedBody m_body;
    QTimer m_idle;
    bool m_timedOut = false;
    bool m_aborted = false;
};
}

NetworkTransport::NetworkTransport(const QString &clientName, QObject *parent, const TransportLimits &limits)
    : Transport(parent)
    , m_manager(new QNetworkAccessManager(this))
    , m_userAgent(clientName.toUtf8() + QByteArrayLiteral("/" TOKKL_VERSION_STRING))
    , m_limits(limits)
{
    // A redirect could carry the Authorization header to another origin.
    m_manager->setRedirectPolicy(QNetworkRequest::ManualRedirectPolicy);
}

QNetworkRequest NetworkTransport::networkRequest(const HttpRequest &request, const QByteArray &accept) const
{
    QNetworkRequest networkRequest(request.url);
    networkRequest.setRawHeader("Authorization", request.authorization);
    networkRequest.setRawHeader("Accept", accept);
    if (!request.idempotencyKey.isEmpty()) {
        networkRequest.setRawHeader("Idempotency-Key", request.idempotencyKey);
    }
    networkRequest.setHeader(QNetworkRequest::UserAgentHeader, m_userAgent);
    networkRequest.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::AuthenticationReuseAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    networkRequest.setAttribute(QNetworkRequest::CacheSaveControlAttribute, false);
    if (!request.body.isEmpty()) {
        networkRequest.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/json"));
    }
    return networkRequest;
}

PendingReply *NetworkTransport::send(const HttpRequest &request)
{
    QNetworkReply *reply = m_manager->sendCustomRequest(networkRequest(request, "application/json"), request.method, request.body);
    return new NetworkReply(request.method, reply, m_limits.timeoutMs, m_limits.maxResponseBytes, this);
}

PendingStream *NetworkTransport::openStream(const HttpRequest &request)
{
    QNetworkRequest streamRequest = networkRequest(request, "text/event-stream");
    // The idle timer of the stream stands in for Qt's transfer timeout.
    streamRequest.setTransferTimeout(0);
    QNetworkReply *reply = m_manager->get(streamRequest);
    return new NetworkStream(reply, m_limits.streamIdleTimeoutMs, m_limits.maxResponseBytes, this);
}

}

#include "transport.moc"
