#pragma once

#include "apitypes.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "transport.h"

#include <QDateTime>
#include <QObject>
#include <QPointer>
#include <QSet>
#include <QTimer>
#include <QVariant>

#include <functional>

namespace Tokkl
{

// The authenticated API client for one configured instance and account.
//
// Settings come from the widget configuration (instanceUrl, authMode, email);
// the secret comes from the credential store. GET /api/v9/me validates them
// and binds the account and its default workspace to the current generation.
// Every operation uses that workspace.
//
// Changing a setting or the stored secret starts a new generation: account
// data and next-start choices are cleared at once, requests in flight are
// aborted, and replies issued under an older generation are dropped.
class Connection : public QObject
{
    Q_OBJECT

    Q_PROPERTY(QString instanceUrl READ instanceUrl WRITE setInstanceUrl NOTIFY instanceUrlChanged)
    // "token" (the default) or "password".
    Q_PROPERTY(QString authMode READ authModeString WRITE setAuthModeString NOTIFY authModeChanged)
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)

    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY stateChanged)
    // A validated account is bound. It stays bound through transient
    // failures (then stale is true) and cooldowns.
    Q_PROPERTY(bool connected READ isConnected NOTIFY stateChanged)
    Q_PROPERTY(bool stale READ isStale NOTIFY stateChanged)
    Q_PROPERTY(bool canWrite READ canWrite NOTIFY stateChanged)
    Q_PROPERTY(QDateTime rateLimitedUntil READ rateLimitedUntil NOTIFY stateChanged)
    Q_PROPERTY(quint64 generation READ generation NOTIFY generationChanged)

    Q_PROPERTY(QVariantMap account READ accountMap NOTIFY accountChanged)
    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY accountChanged)
    Q_PROPERTY(QVariantList projects READ projectList NOTIFY projectsChanged)
    Q_PROPERTY(QVariant currentEntry READ currentEntryVariant NOTIFY currentEntryChanged)

    // Choices for the next start. null or a project id.
    Q_PROPERTY(QVariant nextProjectId READ nextProjectIdVariant WRITE setNextProjectIdVariant NOTIFY nextStartChanged)
    Q_PROPERTY(bool nextBillable READ nextBillable WRITE setNextBillable NOTIFY nextStartChanged)

public:
    enum State {
        Unconfigured, // no instance URL
        InvalidSettings, // the URL or email is not usable; see errorString
        LoadingCredentials,
        CredentialsMissing,
        WalletError, // locked, denied or disabled wallet; nothing is stored elsewhere
        Connecting,
        Connected,
        AuthenticationFailed, // /me answered 401 or 403; retries pause until reconnect()
        RateLimited, // waiting out a 429 cooldown
        Disconnected, // connectivity failure, timeout or 5xx
        Error, // redirect or unexpected response
    };
    Q_ENUM(State)

    template<typename T>
    using Callback = std::function<void(const ApiResult<T> &)>;

    // Uses KDE Wallet and the network.
    explicit Connection(QObject *parent = nullptr);
    // Uses the given transport and store; the connection does not own them.
    Connection(Transport *transport, CredentialStore *store, QObject *parent = nullptr);
    ~Connection() override;

    QString instanceUrl() const;
    void setInstanceUrl(const QString &url);
    AuthMode authMode() const;
    void setAuthMode(AuthMode mode);
    QString authModeString() const;
    void setAuthModeString(const QString &mode);
    QString email() const;
    void setEmail(const QString &email);

    State state() const;
    QString errorString() const;
    bool isConnected() const;
    bool isStale() const;
    bool canWrite() const;
    QDateTime rateLimitedUntil() const;
    quint64 generation() const;

    std::optional<Me> account() const;
    QVariantMap accountMap() const;
    qint64 workspaceId() const;
    QList<Project> projects() const;
    QVariantList projectList() const;
    std::optional<TimeEntry> currentEntry() const;
    QVariant currentEntryVariant() const;

    std::optional<qint64> nextProjectId() const;
    void setNextProjectId(std::optional<qint64> projectId);
    QVariant nextProjectIdVariant() const;
    void setNextProjectIdVariant(const QVariant &projectId);
    bool nextBillable() const;
    void setNextBillable(bool billable);

    // Typed operations. They need a bound account, use its workspace, and
    // refuse while a 429 cooldown runs. Successful replies update the cached
    // account data. done runs later, and only for a reply of the current
    // generation.
    void fetchMe(Callback<Me> done = {});
    void fetchCurrentEntry(Callback<std::optional<TimeEntry>> done = {});
    void fetchProjects(Callback<QList<Project>> done = {});
    void startEntry(const StartEntry &entry, Callback<TimeEntry> done = {});
    void stopEntry(qint64 entryId, Callback<TimeEntry> done = {});
    void updateEntry(qint64 entryId, const TimeEntryUpdate &update, Callback<TimeEntry> done = {});

    // Delay before an automatic retry after a connectivity failure, and the
    // cooldown after a 429 without Retry-After.
    static constexpr int retryDelayMs = 30000;
    static constexpr int defaultCooldownMs = 60000;

public Q_SLOTS:
    // Explicit reconnect: reads the secret again and validates it, also after
    // an authentication failure. A 429 cooldown still applies.
    void reconnect();
    // Automatic revalidation through /me. Does nothing while authentication
    // is paused.
    void refreshAccount();

Q_SIGNALS:
    void instanceUrlChanged();
    void authModeChanged();
    void emailChanged();
    void stateChanged();
    void generationChanged();
    void accountChanged();
    void projectsChanged();
    void currentEntryChanged();
    void nextStartChanged();

private:
    struct Context {
        quint64 generation = 0;
        QString instanceKey;
        Me me;
    };

    void settingsChanged();
    void scheduleReload();
    void reload();
    void onSecretChanged(const QString &key);
    void authenticate(bool explicitRequest);
    void handleMe(const HttpResponse &response);
    void refuseCredentials(const ApiError &error);
    void bind(const Me &me);
    void resetAccount();
    void clearAccountData();
    void setState(State state, const QString &error = QString());
    void startCooldown(const QByteArray &retryAfter);
    void onCooldownEnded();
    bool coolingDown() const;
    bool hasContext() const;
    QString currentCredentialKey() const;

    using ResponseHandler = std::function<void(const HttpResponse &)>;
    void send(const QByteArray &method, const QString &path, const QByteArray &body, ResponseHandler handler);
    enum class Access {
        Read,
        Write, // needs canWrite()
        Account, // validates the credentials, like refreshAccount(); /me and the current entry
    };
    template<typename T>
    void call(const QByteArray &method,
              const QString &path,
              const QByteArray &body,
              Access access,
              std::function<std::optional<T>(const QJsonValue &)> decode,
              std::function<void(const T &)> apply,
              Callback<T> done);
    template<typename T>
    void failLater(ApiError error, Callback<T> done);

    QPointer<Transport> m_transport;
    QPointer<CredentialStore> m_store;

    QString m_instanceText;
    AuthMode m_authMode = AuthMode::Token;
    QString m_email;
    InstanceUrl m_instance;

    quint64 m_generation = 1;
    bool m_hasSecret = false;
    QString m_secret;
    QByteArray m_authorization;
    bool m_authPaused = false;
    bool m_reloadScheduled = false;

    State m_state = Unconfigured;
    QString m_error;
    std::optional<Context> m_context;
    QList<Project> m_projects;
    std::optional<TimeEntry> m_currentEntry;
    std::optional<qint64> m_nextProjectId;
    bool m_nextBillable = false;

    QDateTime m_cooldownUntil;
    QTimer m_cooldownTimer;
    QTimer m_retryTimer;
    QSet<PendingReply *> m_pending;
};

}
