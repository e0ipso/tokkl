// The KDE connection types as the widget creates them: KdeConnection and
// KdeConnectionSetup with the process-wide KWalletCredentialStore and their
// own NetworkTransport.
//
// KDE Wallet is the real client library talking to a fake kwalletd on a
// private D-Bus daemon that this test starts, with no service files, so the
// user's session bus and wallet are never reached. The HTTP side is an
// in-process server on 127.0.0.1.
//
// The store is shared by the whole process and keeps its wallet open between
// operations, so the tests run in order: the failed opens come first, while
// no wallet is open.

#include "instanceurl.h"
#include "kdeconnection.h"
#include "kwalletcredentialstore.h"
#include "transport.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusContext>
#include <QDBusReply>
#include <QFile>
#include <QHash>
#include <QHostAddress>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutex>
#include <QMutexLocker>
#include <QPointer>
#include <QProcess>
#include <QSet>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTest>
#include <QThread>

#include <algorithm>
#include <optional>

using namespace Tokkl;

namespace
{
const QString walletService = QStringLiteral("org.kde.kwalletd6");
const QString walletPath = QStringLiteral("/modules/kwalletd6");

// KWalletCredentialStore::message() for each status. The KDE wording names
// KDE Wallet and System Settings; the neutral text in CredentialResult does
// not.
const QString kdeDisabled =
    QStringLiteral("KDE Wallet is disabled. Enable it in System Settings to save Tokkl credentials; Tokkl does not store them anywhere else.");
const QString kdeUnavailable = QStringLiteral("KDE Wallet is locked or denied access to Tokkl. Unlock the wallet and allow access, then try again.");
const QString kdeFailed = QStringLiteral("KDE Wallet could not read or save the Tokkl credentials.");
const QString notFound = QStringLiteral("No credentials are saved for this instance. Enter them in the widget settings.");

// The kwalletd methods KWallet::Wallet calls for an asynchronous open,
// folders and passwords, with switches for the failures the store maps to a
// status. It lives on its own thread, because the client library makes
// blocking D-Bus calls from the test thread.
class FakeWalletDaemon : public QObject, protected QDBusContext
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.kde.KWallet")

public:
    // Opens answer with an invalid handle: locked, or access denied.
    void setOpenRefused(bool refused)
    {
        QMutexLocker lock(&m_mutex);
        m_openRefused = refused;
    }

    // The Tokkl folder neither exists nor can be created.
    void setFolderRefused(bool refused)
    {
        QMutexLocker lock(&m_mutex);
        m_folderRefused = refused;
    }

    // readPassword and writePassword fail on an open wallet.
    void setReadFails(bool fails)
    {
        QMutexLocker lock(&m_mutex);
        m_readFails = fails;
    }

    void setWriteFails(bool fails)
    {
        QMutexLocker lock(&m_mutex);
        m_writeFails = fails;
    }

    // Every switch back off, also after a test that failed halfway.
    void resetFailures()
    {
        QMutexLocker lock(&m_mutex);
        m_openRefused = m_folderRefused = m_readFails = m_writeFails = false;
    }

    void storeSecret(const QString &folder, const QString &key, const QString &secret)
    {
        QMutexLocker lock(&m_mutex);
        m_secrets.insert(entry(folder, key), secret);
    }

    std::optional<QString> secret(const QString &folder, const QString &key) const
    {
        QMutexLocker lock(&m_mutex);
        const auto it = m_secrets.constFind(entry(folder, key));
        return it == m_secrets.cend() ? std::nullopt : std::optional<QString>(*it);
    }

    int opens() const
    {
        QMutexLocker lock(&m_mutex);
        return m_opens;
    }

public Q_SLOTS:
    int openAsync(const QString &, qlonglong, const QString &, bool)
    {
        QMutexLocker lock(&m_mutex);
        ++m_opens;
        const int transaction = ++m_lastTransaction;
        const int handle = m_openRefused ? -1 : ++m_lastHandle;
        // kwalletd answers the call first and reports the open later.
        QMetaObject::invokeMethod(
            this,
            [this, transaction, handle] {
                Q_EMIT walletAsyncOpened(transaction, handle);
            },
            Qt::QueuedConnection);
        return transaction;
    }

    bool isOpen(int handle)
    {
        return handle > 0;
    }

    int close(int, bool, const QString &)
    {
        return 0;
    }

    bool hasFolder(int, const QString &folder, const QString &)
    {
        QMutexLocker lock(&m_mutex);
        return !m_folderRefused && m_folders.contains(folder);
    }

    bool createFolder(int, const QString &folder, const QString &)
    {
        QMutexLocker lock(&m_mutex);
        if (m_folderRefused) {
            return false;
        }
        m_folders.insert(folder);
        return true;
    }

    bool hasEntry(int, const QString &folder, const QString &key, const QString &)
    {
        QMutexLocker lock(&m_mutex);
        return m_secrets.contains(entry(folder, key));
    }

    QString readPassword(int, const QString &folder, const QString &key, const QString &)
    {
        QMutexLocker lock(&m_mutex);
        if (m_readFails) {
            sendErrorReply(QDBusError::Failed, QStringLiteral("read failed"));
            return QString();
        }
        return m_secrets.value(entry(folder, key));
    }

    int writePassword(int, const QString &folder, const QString &key, const QString &value, const QString &)
    {
        QMutexLocker lock(&m_mutex);
        if (m_writeFails) {
            return -1;
        }
        m_secrets.insert(entry(folder, key), value);
        return 0;
    }

Q_SIGNALS:
    void walletAsyncOpened(int tId, int handle);

private:
    static QString entry(const QString &folder, const QString &key)
    {
        return folder + QLatin1Char('/') + key;
    }

    mutable QMutex m_mutex;
    bool m_openRefused = false;
    bool m_folderRefused = false;
    bool m_readFails = false;
    bool m_writeFails = false;
    int m_opens = 0;
    int m_lastTransaction = 0;
    int m_lastHandle = 0;
    QSet<QString> m_folders;
    QHash<QString, QString> m_secrets;
};

// One HTTP request as the loopback server received it.
struct ReceivedRequest {
    QByteArray method;
    QByteArray path;
    QByteArray head;
    QByteArray body;

    QByteArray header(const QByteArray &name) const
    {
        for (const QByteArray &line : head.split('\n')) {
            const QByteArray trimmed = line.trimmed();
            const qsizetype colon = trimmed.indexOf(':');
            if (colon > 0 && trimmed.left(colon).compare(name, Qt::CaseInsensitive) == 0) {
                return trimmed.mid(colon + 1).trimmed();
            }
        }
        return {};
    }
};

// Answers the Tokkl API calls a connection makes, as user 3 in workspace 7,
// and records every request with its body.
class TokklServer : public QObject
{
    Q_OBJECT

public:
    TokklServer()
    {
        connect(&m_server, &QTcpServer::newConnection, this, [this] {
            while (QTcpSocket *socket = m_server.nextPendingConnection()) {
                connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
                    m_buffers[socket] += socket->readAll();
                    serve(socket);
                });
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
            }
        });
        m_server.listen(QHostAddress::LocalHost);
    }

    QString url(const QString &prefix) const
    {
        return QStringLiteral("http://127.0.0.1:%1%2").arg(m_server.serverPort()).arg(prefix);
    }

    QList<ReceivedRequest> requests;

private:
    void serve(QTcpSocket *socket)
    {
        QByteArray &buffer = m_buffers[socket];
        const qsizetype headEnd = buffer.indexOf("\r\n\r\n");
        if (headEnd < 0) {
            return;
        }
        ReceivedRequest request;
        request.head = buffer.left(headEnd);
        const QList<QByteArray> requestLine = request.head.left(request.head.indexOf("\r\n")).split(' ');
        if (requestLine.size() < 2) {
            return;
        }
        const qsizetype length = request.header("Content-Length").toLongLong();
        if (buffer.size() < headEnd + 4 + length) {
            return;
        }
        request.method = requestLine.at(0);
        request.path = requestLine.at(1);
        request.body = buffer.mid(headEnd + 4, length);
        m_buffers.remove(socket);
        requests.append(request);

        QByteArray body = "[]";
        if (request.path.endsWith("/api/v9/me")) {
            body = QJsonDocument(QJsonObject{
                                     {QStringLiteral("id"), 3},
                                     {QStringLiteral("api_token"), QStringLiteral("tok-kde")},
                                     {QStringLiteral("email"), QStringLiteral("bea@example.test")},
                                     {QStringLiteral("fullname"), QStringLiteral("Bea")},
                                     {QStringLiteral("timezone"), QStringLiteral("UTC")},
                                     {QStringLiteral("default_workspace_id"), 7},
                                     {QStringLiteral("beginning_of_week"), 1},
                                 })
                       .toJson(QJsonDocument::Compact);
        } else if (request.path.endsWith("/me/time_entries/current")) {
            body = "null";
        } else if (request.method == "POST" && request.path.endsWith("/api/v9/workspaces/7/time_entries")) {
            body = QJsonDocument(QJsonObject{
                                     {QStringLiteral("id"), 5},
                                     {QStringLiteral("workspace_id"), 7},
                                     {QStringLiteral("project_id"), QJsonValue::Null},
                                     {QStringLiteral("billable"), false},
                                     {QStringLiteral("start"), QStringLiteral("2026-10-16T08:00:00+00:00")},
                                     {QStringLiteral("stop"), QJsonValue::Null},
                                     {QStringLiteral("duration"), -1792137600},
                                     {QStringLiteral("description"), QString()},
                                     {QStringLiteral("tags"), QJsonArray()},
                                 })
                       .toJson(QJsonDocument::Compact);
        }
        socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + QByteArray::number(body.size())
                      + "\r\nConnection: close\r\n\r\n" + body);
        socket->disconnectFromHost();
    }

    QTcpServer m_server;
    QHash<QTcpSocket *, QByteArray> m_buffers;
};

QString tokenKey(const QString &url)
{
    return credentialKey(parseInstanceUrl(url), AuthMode::Token, QString());
}
}

class KdeConnectionTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        // kwalletrc and every other setting come from an empty directory.
        QVERIFY(m_home.isValid());
        qputenv("HOME", m_home.path().toLocal8Bit());
        qputenv("XDG_CONFIG_HOME", m_home.filePath(QStringLiteral("config")).toLocal8Bit());
        qputenv("XDG_DATA_HOME", m_home.filePath(QStringLiteral("data")).toLocal8Bit());

        // A session bus of our own, without service files: nothing on it
        // can start the real kwalletd.
        const QString config = m_home.filePath(QStringLiteral("bus.conf"));
        QFile file(config);
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write(
            "<!DOCTYPE busconfig PUBLIC \"-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN\"\n"
            " \"http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd\">\n"
            "<busconfig>\n"
            "  <type>session</type>\n"
            "  <listen>unix:dir="
            + m_home.path().toUtf8()
            + "</listen>\n"
              "  <auth>EXTERNAL</auth>\n"
              "  <policy context=\"default\">\n"
              "    <allow send_destination=\"*\" eavesdrop=\"true\"/>\n"
              "    <allow eavesdrop=\"true\"/>\n"
              "    <allow own=\"*\"/>\n"
              "  </policy>\n"
              "</busconfig>\n");
        file.close();
        m_bus.setProgram(QStringLiteral(TOKKL_DBUS_DAEMON));
        m_bus.setArguments({QStringLiteral("--config-file=") + config, QStringLiteral("--nofork"), QStringLiteral("--print-address")});
        m_bus.start();
        QVERIFY2(m_bus.waitForStarted(), qPrintable(m_bus.errorString()));
        QVERIFY(QTest::qWaitFor([this] {
            return m_bus.canReadLine() || m_bus.state() != QProcess::Running;
        }));
        const QByteArray address = m_bus.readLine().trimmed();
        QVERIFY2(!address.isEmpty(), m_bus.readAllStandardError().constData());
        qputenv("DBUS_SESSION_BUS_ADDRESS", address);

        // The fake kwalletd, on its own connection and thread. It moves to
        // the thread after registering, so the signal relay D-Bus gives it
        // as a child moves along.
        m_daemon = new FakeWalletDaemon;
        QDBusConnection daemonBus = QDBusConnection::connectToBus(QString::fromUtf8(address), QStringLiteral("fake-kwalletd"));
        QVERIFY(daemonBus.isConnected());
        QVERIFY(daemonBus.registerObject(walletPath, m_daemon, QDBusConnection::ExportAllSlots | QDBusConnection::ExportAllSignals));
        QVERIFY(daemonBus.registerService(walletService));
        m_daemon->moveToThread(&m_daemonThread);
        connect(&m_daemonThread, &QThread::finished, m_daemon, &QObject::deleteLater);
        m_daemonThread.start();

        // The bus KWallet will use is the private one, and the fake owns
        // the kwalletd name on it.
        QDBusConnection session = QDBusConnection::sessionBus();
        QVERIFY(session.isConnected());
        const QDBusReply<QString> sessionId = session.interface()->call(QStringLiteral("GetId"));
        const QDBusReply<QString> privateId = daemonBus.interface()->call(QStringLiteral("GetId"));
        QVERIFY(sessionId.isValid() && privateId.isValid());
        QCOMPARE(sessionId.value(), privateId.value());
        QCOMPARE(session.interface()->serviceOwner(walletService).value(), daemonBus.baseService());
    }

    void cleanupTestCase()
    {
        // The store closes its wallet while the fake still answers, not when
        // the application goes away after the bus.
        delete KWalletCredentialStore::shared();
        QDBusConnection::disconnectFromBus(QStringLiteral("fake-kwalletd"));
        m_daemonThread.quit();
        m_daemonThread.wait();
        m_bus.terminate();
        m_bus.waitForFinished();
    }

    void cleanup()
    {
        m_daemon->resetFailures();
    }

    // The exact KDE text for every status, and the neutral text where the
    // store adds nothing.
    void walletMessagesNameKdeWallet()
    {
        const KWalletCredentialStore store;
        const auto message = [&store](CredentialResult::Status status) {
            return store.message(CredentialResult{status, {}});
        };
        QCOMPARE(message(CredentialResult::Status::Ok), QString());
        QCOMPARE(message(CredentialResult::Status::NotFound), notFound);
        QCOMPARE(message(CredentialResult::Status::Disabled), kdeDisabled);
        QCOMPARE(message(CredentialResult::Status::Unavailable), kdeUnavailable);
        QCOMPARE(message(CredentialResult::Status::Failed), kdeFailed);
        // Through the base class too, as Connection and ConnectionSetup call it.
        const CredentialStore &base = store;
        QCOMPARE(base.message(CredentialResult{CredentialResult::Status::Unavailable, {}}), kdeUnavailable);
    }

    // A locked wallet, or one that denies Tokkl, is Unavailable.
    void lockedWalletShowsTheKdeText()
    {
        m_daemon->setOpenRefused(true);
        const QString url = m_server.url(QStringLiteral("/locked"));

        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), kdeUnavailable);

        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeUnavailable);

        QVERIFY(m_daemon->opens() >= 2);
        QVERIFY(m_server.requests.isEmpty());
    }

    // The wallet opens but the Tokkl folder cannot be made: Failed.
    void walletWithoutFolderShowsTheKdeText()
    {
        m_daemon->setFolderRefused(true);
        const QString url = m_server.url(QStringLiteral("/nofolder"));

        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), kdeFailed);

        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("tok-unsaved"));
        setup.saveSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeFailed);
        QVERIFY(!m_daemon->secret(KWalletCredentialStore::folder, tokenKey(url)));
    }

    // NotFound keeps the neutral text: it is not a wallet problem.
    void missingSecretShowsTheNeutralText()
    {
        KdeConnection connection;
        connection.setInstanceUrl(m_server.url(QStringLiteral("/missing")));
        QTRY_COMPARE(connection.state(), Connection::CredentialsMissing);
        QCOMPARE(connection.errorString(), notFound);
    }

    // A secret saved from the Configure page reaches the panel's connection,
    // because both use the one store of the process.
    void connectionAndSetupShareTheWalletStore()
    {
        const QString url = m_server.url(QStringLiteral("/shared"));
        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::CredentialsMissing);

        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("tok-kde"));
        setup.saveSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), QString());
        QCOMPARE(m_daemon->secret(KWalletCredentialStore::folder, tokenKey(url)), std::optional<QString>(QStringLiteral("tok-kde")));

        // Only the shared store's secretChanged brings the connection back.
        QTRY_COMPARE(connection.state(), Connection::Connected);
        QCOMPARE(m_server.requests.last().path, QByteArray("/shared/api/v9/me"));
        QCOMPARE(m_server.requests.last().header("Authorization"), "Basic " + QByteArray("tok-kde:api_token").toBase64());

        // No other store was made for either of them.
        const auto stores = QCoreApplication::instance()->findChildren<KWalletCredentialStore *>();
        QCOMPARE(stores.size(), 1);
        QCOMPARE(stores.first(), KWalletCredentialStore::shared());
        QVERIFY(connection.findChildren<CredentialStore *>().isEmpty());
        QVERIFY(setup.findChildren<CredentialStore *>().isEmpty());
    }

    // Each object makes its own transport, parents it and takes it along
    // when destroyed.
    void connectionOwnsItsTransport()
    {
        QObject owner;
        auto *connection = new KdeConnection(&owner);
        QCOMPARE(connection->parent(), &owner);
        const auto transports = connection->findChildren<NetworkTransport *>(Qt::FindDirectChildrenOnly);
        QCOMPARE(transports.size(), 1);
        const QPointer<NetworkTransport> transport = transports.first();

        KdeConnection other;
        QCOMPARE(other.findChildren<NetworkTransport *>(Qt::FindDirectChildrenOnly).size(), 1);
        QVERIFY(other.findChild<NetworkTransport *>() != transport);

        delete connection;
        QVERIFY(transport.isNull());
    }

    void setupOwnsItsTransport()
    {
        QObject owner;
        auto *setup = new KdeConnectionSetup(&owner);
        QCOMPARE(setup->parent(), &owner);
        const auto transports = setup->findChildren<NetworkTransport *>(Qt::FindDirectChildrenOnly);
        QCOMPARE(transports.size(), 1);
        const QPointer<NetworkTransport> transport = transports.first();

        KdeConnectionSetup other;
        QCOMPARE(other.findChildren<NetworkTransport *>(Qt::FindDirectChildrenOnly).size(), 1);
        QVERIFY(other.findChild<NetworkTransport *>() != transport);

        delete setup;
        QVERIFY(transport.isNull());
    }

    // The widget sends tokkl-kde in created_with and the User-Agent.
    void connectionSendsTheKdeClientName()
    {
        const QString url = m_server.url(QStringLiteral("/client"));
        m_daemon->storeSecret(KWalletCredentialStore::folder, tokenKey(url), QStringLiteral("tok-kde"));
        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::Connected);
        const qsizetype before = m_server.requests.size();

        StartEntry start;
        start.start = QDateTime::currentDateTimeUtc();
        connection.startEntry(start);
        QTRY_VERIFY(connection.currentEntry().has_value());

        const auto posted = std::find_if(m_server.requests.cbegin() + before, m_server.requests.cend(), [](const ReceivedRequest &request) {
            return request.method == "POST";
        });
        QVERIFY(posted != m_server.requests.cend());
        QCOMPARE(posted->path, QByteArray("/client/api/v9/workspaces/7/time_entries"));
        QCOMPARE(QJsonDocument::fromJson(posted->body).object().value(QLatin1String("created_with")).toString(), QStringLiteral("tokkl-kde"));
        for (const ReceivedRequest &request : std::as_const(m_server.requests)) {
            if (request.path.startsWith("/client/")) {
                QCOMPARE(request.header("User-Agent"), QByteArray("tokkl-kde/" TOKKL_VERSION_STRING));
            }
        }
    }

    void setupSendsTheKdeUserAgent()
    {
        KdeConnectionSetup setup;
        setup.testConnection(m_server.url(QStringLiteral("/setup")), QStringLiteral("token"), QString(), QStringLiteral("tok-kde"));
        QTRY_COMPARE(setup.testResult(), KdeConnectionSetup::Succeeded);
        QCOMPARE(m_server.requests.last().path, QByteArray("/setup/api/v9/me"));
        QCOMPARE(m_server.requests.last().header("User-Agent"), QByteArray("tokkl-kde/" TOKKL_VERSION_STRING));
    }

    // With the wallet open, a read or write that fails is Failed.
    void failedReadShowsTheKdeText()
    {
        const QString url = m_server.url(QStringLiteral("/unreadable"));
        m_daemon->storeSecret(KWalletCredentialStore::folder, tokenKey(url), QStringLiteral("tok-kde"));
        m_daemon->setReadFails(true);

        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), kdeFailed);

        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeFailed);
        QCOMPARE(setup.secret(), QString());
    }

    void failedWriteShowsTheKdeText()
    {
        const QString url = m_server.url(QStringLiteral("/unwritable"));
        m_daemon->setWriteFails(true);

        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("tok-kde"));
        setup.saveSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeFailed);
        QVERIFY(!m_daemon->secret(KWalletCredentialStore::folder, tokenKey(url)));
    }

    // A write KDE Wallet refuses reaches the panel's connection for the same
    // account through the shared store, also once the Configure page is gone,
    // as when OK closes the dialog. Reconnect reads what the wallet holds.
    void refusedWriteReachesTheConnection()
    {
        const QString url = m_server.url(QStringLiteral("/refused"));
        m_daemon->storeSecret(KWalletCredentialStore::folder, tokenKey(url), QStringLiteral("tok-kde"));
        KdeConnection connection;
        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::Connected);
        const qsizetype requests = m_server.requests.size();

        m_daemon->setWriteFails(true);
        {
            KdeConnectionSetup setup;
            setup.setAccount(url, QStringLiteral("token"), QString());
            setup.editSecret(QStringLiteral("tok-refused"));
            setup.saveSecret();
        }
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), QStringLiteral("The new credentials were not saved. ") + kdeFailed);
        QVERIFY(!connection.isConnected());
        QCOMPARE(m_daemon->secret(KWalletCredentialStore::folder, tokenKey(url)), std::optional<QString>(QStringLiteral("tok-kde")));
        QTest::qWait(50);
        QCOMPARE(m_server.requests.size(), requests);

        m_daemon->setWriteFails(false);
        connection.reconnect();
        QTRY_COMPARE(connection.state(), Connection::Connected);
        QCOMPARE(m_server.requests.last().header("Authorization"), "Basic " + QByteArray("tok-kde:api_token").toBase64());
    }

    // The page can save the secret before the panel's connection gets the
    // matching address. The refusal shows once the address arrives, and the
    // wallet is not read for it.
    void refusedWriteBeforeTheAddressShowsLater()
    {
        const QString url = m_server.url(QStringLiteral("/early"));
        KdeConnection connection;
        QCOMPARE(connection.state(), Connection::Unconfigured);

        m_daemon->setWriteFails(true);
        KdeConnectionSetup setup;
        setup.setAccount(url, QStringLiteral("token"), QString());
        setup.editSecret(QStringLiteral("tok-early"));
        setup.saveSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeFailed);
        m_daemon->setWriteFails(false);

        connection.setInstanceUrl(url);
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), QStringLiteral("The new credentials were not saved. ") + kdeFailed);
        QVERIFY(!m_daemon->secret(KWalletCredentialStore::folder, tokenKey(url)));
        QVERIFY(std::none_of(m_server.requests.cbegin(), m_server.requests.cend(), [](const ReceivedRequest &request) {
            return request.path.startsWith("/early/");
        }));
    }

private:
    QTemporaryDir m_home;
    QProcess m_bus;
    QThread m_daemonThread;
    FakeWalletDaemon *m_daemon = nullptr;
    TokklServer m_server;
};

QTEST_GUILESS_MAIN(KdeConnectionTest)

#include "kdeconnectiontest.moc"
