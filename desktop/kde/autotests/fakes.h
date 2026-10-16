#pragma once

// Scripted stand-ins for the network and KDE Wallet. Nothing here touches a
// real host, wallet or configuration file.

#include "credentialstore.h"
#include "transport.h"

#include <QHash>
#include <QList>
#include <QPointer>

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
            Q_EMIT secretChanged(key);
        }
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
