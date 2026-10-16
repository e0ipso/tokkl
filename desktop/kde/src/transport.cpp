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

PendingReply *NetworkTransport::send(const HttpRequest &request)
{
    QNetworkRequest networkRequest(request.url);
    networkRequest.setRawHeader("Authorization", request.authorization);
    networkRequest.setRawHeader("Accept", "application/json");
    networkRequest.setHeader(QNetworkRequest::UserAgentHeader, m_userAgent);
    networkRequest.setAttribute(QNetworkRequest::CookieLoadControlAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::CookieSaveControlAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::AuthenticationReuseAttribute, QNetworkRequest::Manual);
    networkRequest.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    networkRequest.setAttribute(QNetworkRequest::CacheSaveControlAttribute, false);
    if (!request.body.isEmpty()) {
        networkRequest.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/json"));
    }

    QNetworkReply *reply = m_manager->sendCustomRequest(networkRequest, request.method, request.body);
    return new NetworkReply(reply, m_timeoutMs, this);
}

int NetworkTransport::timeout() const
{
    return m_timeoutMs;
}

void NetworkTransport::setTimeout(int ms)
{
    m_timeoutMs = ms;
}

}

#include "transport.moc"
