#pragma once

// Scripted stand-ins for the network, its streams and KDE Wallet.
// Nothing here touches a real host, wallet or configuration file.

#include "clock.h"
#include "credentialstore.h"
#include "transport.h"

#include <QDateTime>
#include <algorithm>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimeZone>
#include <QList>
#include <QPointer>

// The client name the tests give a connection. It is not the KDE widget's
// "tokkl-kde", so finding it in a request shows the name is passed in.
inline QString testClientName()
{
    return QStringLiteral("tokkl-test");
}

// What a current server announces in GET /api/app/status besides
// setup_required: its API, and the Pomodoro limits the server keeps today.
// A server from before the announcement sends none of it and has none of
// the /api/app routes it names.
inline QJsonObject currentServerApi()
{
    return QJsonObject{
        {QStringLiteral("api_version"), 1},
        {QStringLiteral("capabilities"),
         QJsonArray{QStringLiteral("app-preferences"),
                    QStringLiteral("timer-actions"),
                    QStringLiteral("timer-edit"),
                    QStringLiteral("pomodoro-revision"),
                    QStringLiteral("pause-revision"),
                    QStringLiteral("timer-edit-entry"),
                    QStringLiteral("idempotency-keys"),
                    QStringLiteral("catalog-revision"),
                    QStringLiteral("latest-entry")}},
        {QStringLiteral("pomodoro_limits"),
         QJsonObject{
             {QStringLiteral("work_minutes"), QJsonObject{{QStringLiteral("min"), 1}, {QStringLiteral("max"), 180}, {QStringLiteral("default"), 25}}},
             {QStringLiteral("short_rest_minutes"), QJsonObject{{QStringLiteral("min"), 1}, {QStringLiteral("max"), 60}, {QStringLiteral("default"), 5}}},
             {QStringLiteral("long_rest_minutes"), QJsonObject{{QStringLiteral("min"), 1}, {QStringLiteral("max"), 60}, {QStringLiteral("default"), 15}}},
             {QStringLiteral("long_rest_every"), QJsonObject{{QStringLiteral("min"), 1}, {QStringLiteral("max"), 12}, {QStringLiteral("default"), 4}}},
         }},
    };
}

class FakeReply : public Tokkl::PendingReply
{
    Q_OBJECT

public:
    using Tokkl::PendingReply::PendingReply;

    // Records the abort but stays deliverable, so tests can prove that a
    // late answer to an aborted request is still ignored.
    void abort() override
    {
        aborted = true;
    }

    void deliver(const Tokkl::HttpResponse &response)
    {
        Q_EMIT finished(response);
    }

    bool aborted = false;
};

// A stream the test feeds by hand: push() delivers a piece of data, end()
// the end.
class FakeStream : public Tokkl::PendingStream
{
    Q_OBJECT

public:
    using Tokkl::PendingStream::PendingStream;

    // Records the abort but stays deliverable, like FakeReply.
    void abort() override
    {
        aborted = true;
    }

    void push(const QByteArray &data)
    {
        Q_EMIT dataReceived(data);
    }

    void end(const Tokkl::HttpResponse &response)
    {
        Q_EMIT finished(response);
    }

    bool aborted = false;
};

class FakeTransport : public Tokkl::Transport
{
    Q_OBJECT

public:
    using Tokkl::Transport::Transport;

    // GET /api/app/status of a server from before the announcement, which
    // this app no longer supports, and of a current one.
    static Tokkl::HttpResponse olderStatus()
    {
        return answer(200, R"({"setup_required":false})");
    }

    static Tokkl::HttpResponse currentStatus()
    {
        QJsonObject body = currentServerApi();
        body.insert(QStringLiteral("setup_required"), false);
        return answer(200, QJsonDocument(body).toJson(QJsonDocument::Compact));
    }

    // GET /api/app/workspaces/{wid}/catalog answering revision.
    static Tokkl::HttpResponse catalogAt(qint64 revision)
    {
        return answer(200, QJsonDocument(QJsonObject{{QStringLiteral("revision"), revision}}).toJson(QJsonDocument::Compact));
    }

    // GET /api/app/status and GET /api/app/workspaces/{wid}/catalog are
    // recorded apart from the other requests, so their indexes stay as they
    // were. Unless holdStatus or holdCatalog is set, they get status or
    // catalog from the event loop; a held one waits for respondStatus() or
    // respondCatalog().
    Tokkl::PendingReply *send(const Tokkl::HttpRequest &request) override
    {
        auto *reply = new FakeReply(this);
        const QString path = request.url.path();
        if (request.method == "GET" && path.endsWith(QLatin1String("/api/app/status"))) {
            statusRequests.append(request);
            statusReplies.append(reply);
            if (!holdStatus) {
                deliverLater(reply, status);
            }
            return reply;
        }
        if (request.method == "GET" && path.contains(QLatin1String("/api/app/workspaces/")) && path.endsWith(QLatin1String("/catalog"))) {
            catalogRequests.append(request);
            catalogReplies.append(reply);
            if (!holdCatalog) {
                deliverLater(reply, catalog);
            }
            return reply;
        }
        requests.append(request);
        replies.append(reply);
        return reply;
    }

    void respondStatus(qsizetype index, const Tokkl::HttpResponse &response)
    {
        QPointer<FakeReply> reply = statusReplies.at(index);
        if (reply) {
            reply->deliver(response);
        }
    }

    void respondCatalog(qsizetype index, const Tokkl::HttpResponse &response)
    {
        QPointer<FakeReply> reply = catalogReplies.at(index);
        if (reply) {
            reply->deliver(response);
        }
    }

    // Streams are recorded apart from requests, so the indexes of requests
    // and replies stay as they were.
    Tokkl::PendingStream *openStream(const Tokkl::HttpRequest &request) override
    {
        streamRequests.append(request);
        auto *stream = new FakeStream(this);
        streams.append(stream);
        return stream;
    }

    // The latest stream while it has not been deleted, or nullptr.
    FakeStream *lastStream() const
    {
        return streams.isEmpty() ? nullptr : streams.last().data();
    }

    static Tokkl::HttpResponse answer(int status, const QByteArray &body, const QByteArray &retryAfter = QByteArray())
    {
        Tokkl::HttpResponse response;
        response.outcome = Tokkl::HttpResponse::Outcome::Finished;
        response.status = status;
        response.body = body;
        response.retryAfter = retryAfter;
        return response;
    }

    static Tokkl::HttpResponse failure(Tokkl::HttpResponse::Outcome outcome, const QString &error = QString())
    {
        Tokkl::HttpResponse response;
        response.outcome = outcome;
        response.errorString = error;
        return response;
    }

    void respond(qsizetype index, const Tokkl::HttpResponse &response)
    {
        QPointer<FakeReply> reply = replies.at(index);
        if (reply) {
            reply->deliver(response);
        }
    }

    void respondLast(const Tokkl::HttpResponse &response)
    {
        respond(replies.size() - 1, response);
    }

    QList<Tokkl::HttpRequest> requests;
    QList<QPointer<FakeReply>> replies;
    // The answer GET /api/app/status gets, and whether it waits for the test.
    Tokkl::HttpResponse status = currentStatus();
    bool holdStatus = false;
    QList<Tokkl::HttpRequest> statusRequests;
    QList<QPointer<FakeReply>> statusReplies;
    // The same for the workspace's catalog revision. A test that changes
    // the projects a list read answers sets a new revision here.
    Tokkl::HttpResponse catalog = catalogAt(1);
    bool holdCatalog = false;
    QList<Tokkl::HttpRequest> catalogRequests;
    QList<QPointer<FakeReply>> catalogReplies;
    QList<Tokkl::HttpRequest> streamRequests;
    QList<QPointer<FakeStream>> streams;

private:
    void deliverLater(FakeReply *reply, const Tokkl::HttpResponse &response)
    {
        QMetaObject::invokeMethod(
            this,
            [reply = QPointer<FakeReply>(reply), response] {
                if (reply) {
                    reply->deliver(response);
                }
            },
            Qt::QueuedConnection);
    }
};

class FakeCredentialStore : public Tokkl::CredentialStore
{
    Q_OBJECT

public:
    using Tokkl::CredentialStore::CredentialStore;

    void read(const QString &key, QObject *context, Callback done) override
    {
        ++reads;
        Tokkl::CredentialResult result;
        if (failure != Tokkl::CredentialResult::Status::Ok) {
            result.status = failure;
        } else if (secrets.contains(key)) {
            result.status = Tokkl::CredentialResult::Status::Ok;
            result.secret = secrets.value(key);
        } else {
            result.status = Tokkl::CredentialResult::Status::NotFound;
        }
        later(context, done, result);
    }

    void write(const QString &key, const QString &secret, QObject *context, Callback done) override
    {
        ++writes;
        Tokkl::CredentialResult result;
        result.status = failure;
        if (failure == Tokkl::CredentialResult::Status::Ok) {
            secrets.insert(key, secret);
        }
        reportWrite(key, result);
        later(context, done, result);
    }

    // Ok means reads and writes work.
    Tokkl::CredentialResult::Status failure = Tokkl::CredentialResult::Status::Ok;
    QHash<QString, QString> secrets;
    int reads = 0;
    int writes = 0;

private:
    static void later(QObject *context, const Callback &done, const Tokkl::CredentialResult &result)
    {
        QPointer<QObject> guard(context);
        QMetaObject::invokeMethod(
            context,
            [guard, done, result] {
                if (guard) {
                    done(result);
                }
            },
            Qt::QueuedConnection);
    }
};

// A clock that moves only when the test advances it. Each advance is one tick.
class FakeClock : public Tokkl::Clock
{
    Q_OBJECT

public:
    using Tokkl::Clock::Clock;

    QDateTime now() const override
    {
        return current;
    }

    // jitter, kept below the bound. 0 unless a test sets it, so delays are
    // exact.
    int jitterMs(int boundMs) const override
    {
        return boundMs > 0 ? std::min(jitter, boundMs - 1) : 0;
    }

    void advance(qint64 ms)
    {
        current = current.addMSecs(ms);
        Q_EMIT ticked();
    }

    QDateTime current{QDate(2026, 10, 16), QTime(9, 0), QTimeZone::UTC};
    int jitter = 0;
};
