#include "transport.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

namespace Tokkl
{

namespace
{
class NetworkReply : public PendingReply
{
    Q_OBJECT

public:
    NetworkReply(QNetworkReply *reply, int timeoutMs, QObject *parent)
        : PendingReply(parent)
        , m_reply(reply)
    {
        reply->setParent(this);
        m_timer.setSingleShot(true);
        connect(&m_timer, &QTimer::timeout, this, [this] {
            m_timedOut = true;
            m_reply->abort();
        });
        connect(reply, &QNetworkReply::finished, this, &NetworkReply::onFinished);
        m_timer.start(timeoutMs);
    }

    void abort() override
    {
        m_aborted = true;
        m_reply->abort();
    }

private:
    void onFinished()
    {
        m_timer.stop();
        HttpResponse response;
        const QVariant status = m_reply->attribute(QNetworkRequest::HttpStatusCodeAttribute);
        if (m_aborted) {
            response.outcome = HttpResponse::Outcome::Aborted;
        } else if (m_timedOut) {
            response.outcome = HttpResponse::Outcome::Timeout;
        } else if (status.isValid() && status.toInt() > 0) {
            response.outcome = HttpResponse::Outcome::Finished;
            response.status = status.toInt();
            response.body = m_reply->readAll();
            response.retryAfter = m_reply->rawHeader("Retry-After");
            response.location = m_reply->rawHeader("Location");
        } else {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        }
        Q_EMIT finished(response);
    }

    QNetworkReply *m_reply;
    QTimer m_timer;
    bool m_timedOut = false;
    bool m_aborted = false;
};

class NetworkStream : public PendingStream
{
    Q_OBJECT

public:
    NetworkStream(QNetworkReply *reply, int idleTimeoutMs, QObject *parent)
        : PendingStream(parent)
        , m_reply(reply)
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
        // Any other answer keeps its body for finished().
        if (streaming()) {
            const QByteArray data = m_reply->readAll();
            if (!data.isEmpty()) {
                Q_EMIT dataReceived(data);
            }
        }
    }

    void onFinished()
    {
        m_idle.stop();
        HttpResponse response;
        if (m_aborted) {
            response.outcome = HttpResponse::Outcome::Aborted;
        } else if (m_timedOut) {
            response.outcome = HttpResponse::Outcome::Timeout;
        } else if (streaming() && m_reply->error() != QNetworkReply::NoError) {
            // The connection broke in the middle of the body.
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        } else if (status() > 0) {
            if (streaming()) {
                onReadyRead();
            } else {
                response.body = m_reply->readAll();
            }
            response.outcome = HttpResponse::Outcome::Finished;
            response.status = status();
            response.retryAfter = m_reply->rawHeader("Retry-After");
            response.location = m_reply->rawHeader("Location");
        } else {
            response.outcome = HttpResponse::Outcome::NetworkError;
            response.errorString = m_reply->errorString();
        }
        Q_EMIT finished(response);
    }

    QNetworkReply *m_reply;
    QTimer m_idle;
    bool m_timedOut = false;
    bool m_aborted = false;
};
}

NetworkTransport::NetworkTransport(const QString &clientName, QObject *parent)
    : Transport(parent)
    , m_manager(new QNetworkAccessManager(this))
    , m_userAgent(clientName.toUtf8() + QByteArrayLiteral("/" TOKKL_VERSION_STRING))
{
    // A redirect could carry the Authorization header to another origin.
    // The client reports redirects instead of following them.
    m_manager->setRedirectPolicy(QNetworkRequest::ManualRedirectPolicy);
}

QNetworkRequest NetworkTransport::networkRequest(const HttpRequest &request, const QByteArray &accept) const
{
    QNetworkRequest networkRequest(request.url);
    networkRequest.setRawHeader("Authorization", request.authorization);
    networkRequest.setRawHeader("Accept", accept);
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
    return new NetworkReply(reply, m_timeoutMs, this);
}

PendingStream *NetworkTransport::openStream(const HttpRequest &request)
{
    QNetworkRequest streamRequest = networkRequest(request, "text/event-stream");
    // The idle timer of the stream stands in for Qt's transfer timeout.
    streamRequest.setTransferTimeout(0);
    QNetworkReply *reply = m_manager->get(streamRequest);
    return new NetworkStream(reply, m_streamIdleTimeoutMs, this);
}

int NetworkTransport::timeout() const
{
    return m_timeoutMs;
}

void NetworkTransport::setTimeout(int ms)
{
    m_timeoutMs = ms;
}

int NetworkTransport::streamIdleTimeout() const
{
    return m_streamIdleTimeoutMs;
}

void NetworkTransport::setStreamIdleTimeout(int ms)
{
    m_streamIdleTimeoutMs = ms;
}

}

#include "transport.moc"
