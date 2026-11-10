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

class Clock;

enum class ApiAccess {
    Read,
    Write, // changes something; needs a session that can write
    Account, // validates the credentials: /me and the timer state
};

class ApiSession
{
public:
    virtual ~ApiSession() = default;

    // An answer to a request sent under an earlier generation is dropped.
    virtual quint64 generation() const = 0;
    // Never logged.
    virtual QByteArray authorization() const = 0;
    virtual std::optional<ApiError> refusal(ApiAccess access) const = 0;
    // A readable 2xx answer: the instance is reachable.
    virtual void answered() = 0;
    // False when the failure ended the generation, so whoever waits is gone too.
    virtual bool absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access) = 0;
    virtual const Clock &clock() const = 0;
};

// Asks the session before each request and delivers an answer only within
// the generation it went out in.
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

    // Neither is owned; the session must outlive the client.
    ApiClient(Transport *transport, ApiSession &session, QObject *parent = nullptr);
    ~ApiClient() override;

    // Skips the session check. Without a transport the request fails as a
    // network error.
    void send(const QByteArray &method, const QUrl &url, const QByteArray &body, ResponseHandler handler, const QByteArray &idempotencyKey = QByteArray());

    // done runs only within this generation; a body decode rejects gives
    // InvalidResponse.
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

    void action(const QUrl &url, const QByteArray &body, ActionCallback done);
    // Resent once with the same body and key after an unknown outcome, so the
    // server replays its first answer or acts now.
    void keyedAction(const QUrl &url, const QByteArray &body, const QByteArray &idempotencyKey, ActionCallback done);

    // One key stands for one user intent.
    static QByteArray newIdempotencyKey();

    // nullptr without a transport or when the session refuses a read. The client
    // deletes the stream after finished().
    PendingStream *openStream(const QUrl &url);

    // Call once the generation has moved on, so the answers are dropped.
    void abortAll();

private:
    // False when the body is not the expected value.
    using BodyReader = std::function<bool(const QJsonValue &)>;
    // nullopt for success.
    using Completion = std::function<void(const std::optional<ApiError> &)>;

    void request(const QByteArray &method, const QUrl &url, const QByteArray &body, ApiAccess access, BodyReader read, Completion finish);
    void sendAction(const QUrl &url, const QByteArray &body, const QByteArray &idempotencyKey, ActionCallback done);
    // Skipped if the generation changes or the client goes first.
    void later(std::function<void()> f, int delayMs = 0);

    QPointer<Transport> m_transport;
    ApiSession &m_session;
    QSet<PendingReply *> m_replies;
    QSet<PendingStream *> m_streams;
};

}
