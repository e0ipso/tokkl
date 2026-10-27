#pragma once

// Scripted stand-ins for the network, its streams, KDE Wallet and the pause
// chain store.
// Nothing here touches a real host, wallet or configuration file.

#include "chainstore.h"
#include "clock.h"
#include "credentialstore.h"
#include "transport.h"

#include <QDateTime>
#include <QHash>
#include <QTimeZone>
#include <QList>
#include <QPointer>

// The client name the tests give a connection. It is not the KDE widget's
// "tokkl-kde", so finding it in a request shows the name is passed in.
inline QString testClientName()
{
    return QStringLiteral("tokkl-test");
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

    Tokkl::PendingReply *send(const Tokkl::HttpRequest &request) override
    {
        requests.append(request);
        auto *reply = new FakeReply(this);
        replies.append(reply);
        return reply;
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
    QList<Tokkl::HttpRequest> streamRequests;
    QList<QPointer<FakeStream>> streams;
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

// Keeps the pause chain in memory and counts the saves.
class FakeChainStore : public Tokkl::ChainStore
{
    Q_OBJECT

public:
    using Tokkl::ChainStore::ChainStore;

    std::optional<Tokkl::PauseChain> load() override
    {
        ++loads;
        return stored;
    }

    void save(const std::optional<Tokkl::PauseChain> &chain) override
    {
        ++saves;
        stored = chain;
    }

    std::optional<Tokkl::PauseChain> stored;
    int loads = 0;
    int saves = 0;
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

    void advance(qint64 ms)
    {
        current = current.addMSecs(ms);
        Q_EMIT ticked();
    }

    QDateTime current{QDate(2026, 10, 16), QTime(9, 0), QTimeZone::UTC};
};
