#pragma once

#include "apiclient.h"
#include "apitypes.h"
#include "clock.h"
#include "cooldown.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "sessioncredentials.h"
#include "transport.h"

#include <QDateTime>
#include <QObject>
#include <QTimer>
#include <QUrl>
#include <QVariant>

#include <functional>
#include <memory>
#include <optional>

namespace Tokkl
{

// One instance and account. Validates through /me, and only against a server
// at ServerFloor or newer.
class Connection : public QObject, public ApiSession
{
    Q_OBJECT

    Q_PROPERTY(QString instanceUrl READ instanceUrl WRITE setInstanceUrl NOTIFY instanceUrlChanged)
    // "token" (the default) or "password".
    Q_PROPERTY(QString authMode READ authModeString WRITE setAuthModeString NOTIFY authModeChanged)
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)
    // Normalized, without user info, query or fragment, so it never carries
    // credentials. Empty while the URL is not usable.
    Q_PROPERTY(QUrl webUrl READ webUrl NOTIFY instanceUrlChanged)

    Q_PROPERTY(Tokkl::Connection::State state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY stateChanged)
    // Stays true through transient failures (then stale) and cooldowns.
    Q_PROPERTY(bool connected READ isConnected NOTIFY stateChanged)
    Q_PROPERTY(bool stale READ isStale NOTIFY stateChanged)
    Q_PROPERTY(bool canWrite READ canWrite NOTIFY stateChanged)
    Q_PROPERTY(QDateTime rateLimitedUntil READ rateLimitedUntil NOTIFY stateChanged)
    Q_PROPERTY(quint64 generation READ generation NOTIFY generationChanged)

    Q_PROPERTY(qint64 workspaceId READ workspaceId NOTIFY accountChanged)

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

    // Connectivity retries: 30 s doubling to 2 min, plus jitter.
    static constexpr int retryBaseMs = 30000;
    static constexpr int retryMaxMs = 120000;

    template<typename T>
    using Callback = ApiClient::Callback<T>;
    using ActionCallback = ApiClient::ActionCallback;

    // None of these is owned; all must outlive the connection. clientName goes
    // into created_with of the entries it starts.
    Connection(Transport *transport, CredentialStore *store, const Clock &clock, const QString &clientName, QObject *parent = nullptr);

    QString instanceUrl() const;
    void setInstanceUrl(const QString &url);
    AuthMode authMode() const;
    void setAuthMode(AuthMode mode);
    QString authModeString() const;
    void setAuthModeString(const QString &mode);
    QString email() const;
    void setEmail(const QString &email);
    QUrl webUrl() const;

    State state() const;
    QString errorString() const;
    bool isConnected() const;
    bool isStale() const;
    bool canWrite() const;
    QDateTime rateLimitedUntil() const;
    quint64 generation() const override;

    std::optional<Me> account() const;
    ServerApi server() const;
    QVariantMap accountMap() const;
    qint64 workspaceId() const;
    // One key for per-account device data; empty without an account.
    QString owner() const;

    // These need a bound account and refuse during a 429 cooldown. done runs
    // only for a reply of the current generation.
    void fetchMe(Callback<Me> done = {});
    // Stops after maxProjectPages and still succeeds, marking the list
    // incomplete.
    void fetchProjects(Callback<ProjectList> done = {});
    // The server bumps it with every write that changes fetchProjects().
    void fetchCatalogRevision(Callback<qint64> done = {});
    // Archived or not.
    void fetchProject(qint64 projectId, Callback<Project> done = {});
    // Newest by start, in any workspace. None for an account without entries.
    void fetchLatestEntry(Callback<std::optional<ListedEntry>> done = {});
    // A length outside the server's pomodoro_limits reads as its default.
    void fetchPreferences(Callback<PomodoroConfig> done = {});
    // Posts only the lengths the update sets. done gets what the server holds
    // afterwards.
    void savePreferences(const PomodoroConfigUpdate &update, Callback<PomodoroConfig> done = {});

    // Like /me, a 401 or 403 means the credentials were refused.
    void fetchTimerState(Callback<TimerState> done = {});
    // Each needs canWrite(). Revisioned actions apply only to the state at
    // revision; a 409 brings the server's state.
    void pauseTimer(qint64 revision, ActionCallback done = {});
    void resumeTimer(qint64 revision, ActionCallback done = {});
    void discardPause(qint64 revision, ActionCallback done = {});
    void startPomodoro(qint64 revision, const PomodoroStart &start, ActionCallback done = {});
    void nextPomodoroPhase(qint64 revision, ActionCallback done = {});
    void endPomodoro(qint64 revision, ActionCallback done = {});
    // A 409 also answers a stop when nothing runs. Starts carry an
    // Idempotency-Key and are resent once after an unknown outcome.
    void startTimer(qint64 revision, const StartEntry &entry, ActionCallback done = {});
    void stopTimer(qint64 revision, ActionCallback done = {});
    // Never sends start. Only a stopped entryId makes the server refuse it.
    void editTimer(qint64 entryId, const TimeEntryUpdate &update, ActionCallback done = {});
    // nullptr without a bound account or during a cooldown. The connection
    // deletes the stream after finished(); a new generation aborts it.
    PendingStream *openTimerEvents();

    static constexpr int projectPageSize = 200;
    static constexpr int maxProjectPages = 100;

public Q_SLOTS:
    // Also after an authentication failure. A 429 cooldown still applies.
    void reconnect();
    // Does nothing while authentication is paused.
    void refreshAccount();

Q_SIGNALS:
    void instanceUrlChanged();
    void authModeChanged();
    void emailChanged();
    void stateChanged();
    void generationChanged();
    void accountChanged();

private:
    struct Context {
        quint64 generation = 0;
        Me me;
    };
    // A failed read leaves server empty, which is below the floor.
    struct Announcement {
        quint64 generation = 0;
        bool pending = false;
        ServerApi server;
    };

    QByteArray authorization() const override;
    std::optional<ApiError> refusal(ApiAccess access) const override;
    void answered() override;
    bool absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access) override;
    const Clock &clock() const override;

    void settingsChanged();
    void scheduleReload();
    void reload();
    void onSecretRead(const CredentialResult &result);
    void showFailedWrite(CredentialResult::Status status);
    void authenticate(bool explicitRequest);
    void readAnnouncement();
    void sendMe();
    void handleMe(const HttpResponse &response);
    // A failed /me, or a failed status read before it.
    void handleFailure(const HttpResponse &response, const ApiError &error);
    void refuseCredentials(const ApiError &error);
    void pauseAuthentication(const QString &message);
    void bind(const Me &me);
    void resetAccount();
    void clearAccount();
    void setState(State state, const QString &error = QString());
    void startCooldown(const QByteArray &retryAfter, const QString &message);
    void onCooldownEnded();

    struct ProjectPages;
    void fetchProjectPage(const std::shared_ptr<ProjectPages> &pages);
    QUrl api(const QString &path) const;
    QUrl app(const QString &path) const;
    ApiClient::Decoder<PomodoroConfig> preferencesDecoder() const;

    const QString m_clientName;
    SessionCredentials m_credentials;
    quint64 m_generation = 1;
    bool m_authPaused = false;
    bool m_reloadScheduled = false;
    State m_state = Unconfigured;
    QString m_error;
    std::optional<Context> m_context;
    Announcement m_announcement;
    Cooldown m_cooldown;
    QTimer m_retryTimer;
    RetryBackoff m_retry{retryBaseMs, retryMaxMs};
    const Clock &m_clock;
    ApiClient m_api;
};

}
