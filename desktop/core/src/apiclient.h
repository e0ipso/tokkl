#pragma once

#include "apitypes.h"
#include "transport.h"

#include <QSet>
#include <QObject>
#include <QPointer>
#include <QUrl>

#include <functional>
#include <memory>
#include <optional>

namespace Tokkl
{

// What a request is for, which decides when it may go out and what a
// refusal of it means.
enum class ApiAccess {
    Read,
    Write, // changes something; needs a session that can write
    Account, // validates the credentials: /me and the timer state
};

// The session an ApiClient sends for: the credentials, the context the
// answers belong to, and what a failed answer does to them.
class ApiSession
{
public:
    virtual ~ApiSession() = default;

    // Changes with the instance, account or credentials. An answer to a
    // request sent under an earlier generation is dropped.
    virtual quint64 generation() const = 0;
    // The Authorization header value. It is never logged.
    virtual QByteArray authorization() const = 0;
    // Why a request with this access may not go out now, or nullopt.
    virtual std::optional<ApiError> refusal(ApiAccess access) const = 0;
    // A request got a readable 2xx answer: the instance is reachable.
    virtual void answered() = 0;
    // A request failed with error. False when that ended the generation, so
    // whoever waits for the answer is gone too.
    virtual bool absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access) = 0;
};

// Sends the API requests of one session through a transport. It asks the
// session before each request, hands it every failure, and delivers an
// answer only within the generation the request went out in.
class ApiClient : public QObject
{
    Q_OBJECT

public:
    template<typename T>
    using Callback = std::function<void(const ApiResult<T> &)>;
    template<typename T>
    using Decoder = std::function<std::optional<T>(const QJsonValue &)>;
    using ActionCallback = std::function<void(const TimerActionResult &)>;
    using ResponseHandler = std::function<void(const HttpResponse &)>;

    // Neither the transport nor the session is owned; the session outlives
    // the client.
    ApiClient(Transport *transport, ApiSession &session, QObject *parent = nullptr);
    ~ApiClient() override;

    // Sends the request without asking the session. handler gets the raw
    // response, later, and only within this generation. Without a transport
    // the request fails as one that found no network.
    void send(const QByteArray &method, const QUrl &url, const QByteArray &body, ResponseHandler handler);

    // A request whose 2xx answer is a JSON body that decode reads. done runs
    // later, and only within this generation, with the value, the refusal,
    // the error of the answer, or InvalidResponse for a body decode rejects.
    template<typename T>
    void call(const QByteArray &method, const QUrl &url, const QByteArray &body, ApiAccess access, Decoder<T> decode, Callback<T> done)
    {
        auto value = std::make_shared<std::optional<T>>();
        request(
            method,
            url,
            body,
            access,
            [decode = std::move(decode), value](const QJsonValue &json) {
                *value = decode(json);
                return value->has_value();
            },
            [done = std::move(done), value](const std::optional<ApiError> &error) {
                if (done) {
                    done(error ? ApiResult<T>::failure(*error) : ApiResult<T>::success(std::move(**value)));
                }
            });
    }

    // A POST to a timer action. A write: done tells apart a change made, a
    // 409 with the server's state, nothing changed, and an unknown outcome.
    void action(const QUrl &url, const QByteArray &body, ActionCallback done);

    // Opens an event stream, or returns nullptr without a transport or when
    // the session refuses a read. The caller reads the stream's signals;
    // the client deletes it after finished(). A 401, 403 or 429 that ends
    // it goes to the session as a failure of an Account request.
    PendingStream *openStream(const QUrl &url);

    // Aborts every request and stream in flight. Call it once the session's
    // generation has moved on, so their answers are dropped.
    void abortAll();

private:
    // Reads a 2xx JSON body; false when it is not the expected value.
    using BodyReader = std::function<bool(const QJsonValue &)>;
    // nullopt for success.
    using Completion = std::function<void(const std::optional<ApiError> &)>;

    void request(const QByteArray &method, const QUrl &url, const QByteArray &body, ApiAccess access, BodyReader read, Completion finish);
    // Runs f from the event loop, unless the generation changes first.
    void later(std::function<void()> f);

    QPointer<Transport> m_transport;
    ApiSession &m_session;
    QSet<PendingReply *> m_replies;
    QSet<PendingStream *> m_streams;
};

}
