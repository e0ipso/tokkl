#include "apiclient.h"

#include "clock.h"
#include "logging.h"

#include <QTimer>
#include <QUuid>

#include <utility>

namespace Tokkl
{

namespace
{
ApiError localError(ApiError::Kind kind, const QString &message)
{
    ApiError error;
    error.kind = kind;
    error.message = message;
    return error;
}

bool isSuccess(const HttpResponse &response)
{
    return response.outcome == HttpResponse::Outcome::Finished && response.status >= 200 && response.status < 300;
}

ApiError unreadableAnswer()
{
    return localError(ApiError::Kind::InvalidResponse, ApiClient::tr("The instance sent a response Tokkl could not read."));
}

}

ApiClient::ApiClient(Transport *transport, ApiSession &session, QObject *parent)
    : QObject(parent)
    , m_transport(transport)
    , m_session(session)
{
}

ApiClient::~ApiClient()
{
    // Replies belong to the transport; stop them reaching this object.
    for (PendingReply *reply : std::as_const(m_replies)) {
        disconnect(reply, nullptr, this, nullptr);
        reply->abort();
        reply->deleteLater();
    }
    for (PendingStream *stream : std::as_const(m_streams)) {
        disconnect(stream, nullptr, this, nullptr);
        stream->abort();
        stream->deleteLater();
    }
}

void ApiClient::abortAll()
{
    const QSet<PendingReply *> replies = std::exchange(m_replies, {});
    for (PendingReply *reply : replies) {
        // The reply still finishes; its generation no longer matches.
        reply->abort();
    }
    const QSet<PendingStream *> streams = std::exchange(m_streams, {});
    for (PendingStream *stream : streams) {
        stream->abort();
    }
}

void ApiClient::later(std::function<void()> f, int delayMs)
{
    const quint64 generation = m_session.generation();
    auto run = [this, generation, f = std::move(f)] {
        if (generation == m_session.generation()) {
            f();
        }
    };
    if (delayMs > 0) {
        QTimer::singleShot(delayMs, this, std::move(run));
    } else {
        QMetaObject::invokeMethod(this, std::move(run), Qt::QueuedConnection);
    }
}

void ApiClient::send(const QByteArray &method, const QUrl &url, const QByteArray &body, ResponseHandler handler, const QByteArray &idempotencyKey)
{
    if (!m_transport) {
        // The transport went first, as at shutdown. The request fails like
        // one that found no network.
        HttpResponse response;
        response.errorString = tr("Tokkl has no network access.");
        later([handler = std::move(handler), response] {
            handler(response);
        });
        return;
    }
    const quint64 generation = m_session.generation();
    PendingReply *reply = m_transport->send(HttpRequest{method, url, m_session.authorization(), body, idempotencyKey});
    m_replies.insert(reply);
    connect(reply, &PendingReply::finished, this, [this, reply, generation, handler = std::move(handler)](const HttpResponse &response) {
        m_replies.remove(reply);
        reply->deleteLater();
        if (generation != m_session.generation()) {
            return; // issued for an earlier instance, account or credential
        }
        handler(response);
    });
}

void ApiClient::request(const QByteArray &method, const QUrl &url, const QByteArray &body, ApiAccess access, BodyReader read, Completion finish)
{
    if (const std::optional<ApiError> refused = m_session.refusal(access)) {
        later([finish = std::move(finish), error = *refused] {
            finish(error);
        });
        return;
    }

    send(method, url, body, [this, method, path = url.path(), access, read = std::move(read), finish = std::move(finish)](const HttpResponse &response) {
        if (isSuccess(response)) {
            const std::optional<QJsonValue> json = parseJsonBody(response.body);
            if (!json || !read(*json)) {
                qCWarning(lcNet) << method << path << "answered with a body Tokkl could not read";
                finish(unreadableAnswer());
                return;
            }
            m_session.answered();
            finish(std::nullopt);
            return;
        }

        const ApiError error = errorFromResponse(response);
        if (!m_session.absorbFailure(response, error, access)) {
            return; // the generation changed; the caller's state is gone too
        }
        // A 403 from a workspace operation can mean many things; the caller
        // decides, for example by revalidating the account.
        finish(error);
    });
}

QByteArray ApiClient::newIdempotencyKey()
{
    return QUuid::createUuid().toByteArray(QUuid::Id128);
}

void ApiClient::action(const QUrl &url, const QByteArray &body, ActionCallback done)
{
    keyedAction(url, body, QByteArray(), std::move(done));
}

void ApiClient::keyedAction(const QUrl &url, const QByteArray &body, const QByteArray &idempotencyKey, ActionCallback done)
{
    if (const std::optional<ApiError> refused = m_session.refusal(ApiAccess::Write)) {
        if (done) {
            later([done = std::move(done), error = *refused] {
                done(TimerActionResult{TimerActionResult::Outcome::Refused, std::nullopt, error});
            });
        }
        return;
    }
    if (idempotencyKey.isEmpty()) {
        sendAction(url, body, idempotencyKey, std::move(done));
        return;
    }
    sendAction(url, body, idempotencyKey, [this, url, body, idempotencyKey, done = std::move(done)](const TimerActionResult &first) {
        // The same key and body, so a server that acted on the first answers
        // with what it did then.
        if (first.outcome != TimerActionResult::Outcome::Unknown || m_session.refusal(ApiAccess::Write)) {
            if (done) {
                done(first);
            }
            return;
        }
        // At once it would likely meet the same failure.
        const int waitMs = retryWaitMs(retryMinMs, m_session.clock());
        qCInfo(lcNet) << "POST" << url.path() << "outcome unknown; sending it once more with its Idempotency-Key in" << waitMs << "ms";
        later(
            [this, url, body, idempotencyKey, done, first] {
                if (m_session.refusal(ApiAccess::Write)) {
                    if (done) {
                        done(first);
                    }
                    return;
                }
                sendAction(url, body, idempotencyKey, done);
            },
            waitMs);
    });
}

void ApiClient::sendAction(const QUrl &url, const QByteArray &body, const QByteArray &idempotencyKey, ActionCallback done)
{
    send("POST", url, body, [this, path = url.path(), done = std::move(done)](const HttpResponse &response) {
        TimerActionResult result;
        if (isSuccess(response)) {
            const std::optional<QJsonValue> json = parseJsonBody(response.body);
            result.state = json ? decodeTimerState(*json) : std::nullopt;
            if (result.state) {
                result.outcome = TimerActionResult::Outcome::Applied;
                m_session.answered();
            } else {
                qCWarning(lcNet) << "POST" << path << "answered with a body Tokkl could not read";
                // The server answered, so it may well have made the change.
                result.outcome = TimerActionResult::Outcome::Unknown;
                result.error = unreadableAnswer();
            }
        } else {
            result.error = errorFromResponse(response);
            if (response.outcome == HttpResponse::Outcome::Finished && response.status == 409) {
                const std::optional<QJsonValue> json = parseJsonBody(response.body);
                result.state = json ? decodeTimerState(*json) : std::nullopt;
                result.outcome = result.state ? TimerActionResult::Outcome::Conflict : TimerActionResult::Outcome::Refused;
            } else if (!m_session.absorbFailure(response, result.error, ApiAccess::Write)) {
                return; // the generation changed; the caller's state is gone too
            } else {
                result.outcome = result.error.outcomeUnknown() ? TimerActionResult::Outcome::Unknown : TimerActionResult::Outcome::Refused;
            }
        }
        if (done) {
            done(result);
        }
    }, idempotencyKey);
}

PendingStream *ApiClient::openStream(const QUrl &url)
{
    if (m_session.refusal(ApiAccess::Read) || !m_transport) {
        return nullptr;
    }
    const quint64 generation = m_session.generation();
    PendingStream *stream = m_transport->openStream(HttpRequest{"GET", url, m_session.authorization(), QByteArray()});
    m_streams.insert(stream);
    // Connected before the caller gets the stream, so this runs first.
    connect(stream, &PendingStream::finished, this, [this, stream, generation](const HttpResponse &response) {
        m_streams.remove(stream);
        stream->deleteLater();
        if (generation != m_session.generation() || response.outcome != HttpResponse::Outcome::Finished) {
            return;
        }
        // Streams end for many reasons, and the caller reads the state after
        // one. Only a refusal says something about the session.
        const ApiError error = errorFromResponse(response);
        if (asksToWait(response) || error.kind == ApiError::Kind::Forbidden || error.kind == ApiError::Kind::Unauthorized) {
            m_session.absorbFailure(response, error, ApiAccess::Account);
        }
    });
    return stream;
}

}
