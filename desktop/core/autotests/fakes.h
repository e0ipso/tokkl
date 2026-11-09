#pragma once

// Scripted stand-ins for the network, its streams and KDE Wallet.
// Nothing here touches a real host, wallet or configuration file.

#include "apitypes.h"
#include "clock.h"
#include "credentialstore.h"
#include "instanceurl.h"
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

// The store key of a token account on the instance at url.
inline QString tokenKey(const QString &url)
{
    return Tokkl::credentialKey(Tokkl::parseInstanceUrl(url), Tokkl::AuthMode::Token, QString());
}

inline QByteArray json(const QJsonValue &value)
{
    return value.isArray() ? QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);
}

inline QString iso(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODateWithMs);
}

// The account GET /api/v9/me answers.
inline QByteArray meBody(qint64 id = 3, qint64 workspace = 7)
{
    return json(QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("email"), QStringLiteral("bea@example.test")},
        {QStringLiteral("fullname"), QStringLiteral("Bea")},
        {QStringLiteral("timezone"), QStringLiteral("UTC")},
        {QStringLiteral("default_workspace_id"), workspace},
        {QStringLiteral("beginning_of_week"), 1},
    });
}

// The account's preferences with these Pomodoro lengths, and one key the
// companions do not read.
inline QByteArray preferencesBody(const Tokkl::PomodoroConfig &config = {1, 1, 1, 2})
{
    return json(QJsonObject{
        {QStringLiteral("pomodoro_focus_interval_in_minutes"), config.workMinutes},
        {QStringLiteral("pomodoro_break_interval_in_minutes"), config.shortRestMinutes},
        {QStringLiteral("pomodoro_long_break_interval_in_minutes"), config.longRestMinutes},
        {QStringLiteral("pomodoro_long_break_every"), config.longRestEvery},
        {QStringLiteral("theme"), QStringLiteral("dark")},
    });
}

// An error body: the API sends the message as a bare JSON string.
inline QByteArray errorBody(const char *text)
{
    return QByteArrayLiteral("\"") + QByteArray(text) + QByteArrayLiteral("\"");
}

// A session's phase on the server's clock, with what the server derives
// from it, for one-minute lengths and a long rest after every second work.
struct Phase {
    QString kind;
    QDateTime start;
    int completed = 0;
    QString upcoming;
    QString transition;
    int number = 1;
    QDateTime pomodoroStart;
};

inline Phase work(const QDateTime &start, int completed = 0)
{
    const bool last = completed + 1 >= 2;
    return Phase{QStringLiteral("work"),
                 start,
                 completed,
                 last ? QStringLiteral("longRest") : QStringLiteral("shortRest"),
                 last ? QStringLiteral("workToLongRest") : QStringLiteral("workToShortRest"),
                 completed + 1,
                 start};
}

inline Phase shortRest(const QDateTime &start, const QDateTime &pomodoroStart)
{
    return Phase{QStringLiteral("shortRest"), start, 1, QStringLiteral("work"), QStringLiteral("shortRestToWork"), 1, pomodoroStart};
}

inline QJsonObject pomodoroJson(const Phase &phase, qint64 entryId)
{
    return QJsonObject{
        {QStringLiteral("work_minutes"), 1},
        {QStringLiteral("short_rest_minutes"), 1},
        {QStringLiteral("long_rest_minutes"), 1},
        {QStringLiteral("long_rest_every"), 2},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), phase.kind},
             {QStringLiteral("start"), iso(phase.start)},
             {QStringLiteral("completed"), phase.completed},
             {QStringLiteral("planned_end"), iso(phase.start.addSecs(60))},
         }},
        {QStringLiteral("upcoming_phase"), phase.upcoming},
        {QStringLiteral("transition"), phase.transition},
        {QStringLiteral("number"), phase.number},
        {QStringLiteral("entry_id"), entryId},
        {QStringLiteral("pomodoro_start"), iso(phase.pomodoroStart.isValid() ? phase.pomodoroStart : phase.start)},
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

// A keyring whose writes wait until the test finishes them, in any order.
// Reads find nothing.
class HeldStore : public FakeCredentialStore
{
    Q_OBJECT

public:
    struct Write {
        QString key;
        QPointer<QObject> context;
        Callback done;
    };

    void write(const QString &key, const QString &, QObject *context, Callback done) override
    {
        held.append(Write{key, context, done});
    }

    void finish(qsizetype index)
    {
        const Write write = held.at(index);
        const Tokkl::CredentialResult result{Tokkl::CredentialResult::Status::Ok, QString()};
        reportWrite(write.key, result);
        if (write.context) {
            write.done(result);
        }
    }

    QList<Write> held;
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
