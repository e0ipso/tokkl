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

// The API of one configured instance and account, for QML and the
// companions.
//
// The settings name the instance, the sign-in mode and, for passwords, the
// email; the secret comes from the credential store. GET /api/v9/me
// validates them and binds the account and its default workspace to the
// current generation. Before the first /me of a generation, GET
// /api/app/status reads what the server announces. An account binds only on
// a server at ServerFloor or newer; an older one, or one that announces
// nothing, leaves the state Error with a message that asks for a server
// update. A status read that fails as /me can (no answer, a timeout, a 5xx
// or a 429) fails the validation the same way, without sending /me.
//
// Changing a setting or the stored secret starts a new generation: the
// account is cleared at once, requests in flight are aborted, and replies
// issued under an older generation are dropped. When the store refuses to
// write a secret for this account, the account goes and the state is
// WalletError. The typed operations all use the bound account's default
// workspace.
class Connection : public QObject, public ApiSession
{
    Q_OBJECT

    Q_PROPERTY(QString instanceUrl READ instanceUrl WRITE setInstanceUrl NOTIFY instanceUrlChanged)
    // "token" (the default) or "password".
    Q_PROPERTY(QString authMode READ authModeString WRITE setAuthModeString NOTIFY authModeChanged)
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)
    // The configured instance's address for a browser: normalized, with its
    // path prefix and no user info, query or fragment. Empty while the URL is
    // not usable. It never carries credentials.
    Q_PROPERTY(QUrl webUrl READ webUrl NOTIFY instanceUrlChanged)

    Q_PROPERTY(Tokkl::Connection::State state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY stateChanged)
    // A validated account is bound. It stays bound through transient
    // failures (then stale is true) and cooldowns.
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

    // The retry waits of a validation that failed for connectivity: 30 s,
    // doubling up to 2 min, plus up to a quarter more of the clock's jitter.
    static constexpr int retryBaseMs = 30000;
    static constexpr int retryMaxMs = 120000;

    template<typename T>
    using Callback = ApiClient::Callback<T>;
    using ActionCallback = ApiClient::ActionCallback;

    // Uses the given transport, store and clock, which the connection does
    // not own and which must outlive it. The clock's jitter spreads the retry
    // waits of the account's validation and of a start's resend. clientName
    // goes into the created_with field of the entries it starts.
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
    // What the server announced in GET /api/app/status before the account
    // bound, ServerFloor or newer; none without an account.
    ServerApi server() const;
    QVariantMap accountMap() const;
    qint64 workspaceId() const;
    // The instance, account and workspace of the validated account as one
    // key, for what a device keeps per account. Empty without one.
    QString owner() const;

    // Typed operations. They need a bound account, use its workspace, and
    // refuse while a 429 cooldown runs. The connection keeps nothing of
    // their answers but the account from /me. done runs later, and only for
    // a reply of the current generation. A valid /me binds the account.
    void fetchMe(Callback<Me> done = {});
    // Every active project of the workspace, following the pages up to
    // maxProjectPages. A workspace beyond that still succeeds with the
    // projects read, and the list says it is cut short.
    void fetchProjects(Callback<ProjectList> done = {});
    // The number GET /api/app/workspaces/{wid}/catalog answers, which the
    // server changes with every write that changes what fetchProjects()
    // answers.
    void fetchCatalogRevision(Callback<qint64> done = {});
    // One project of the workspace, archived or not.
    void fetchProject(qint64 projectId, Callback<Project> done = {});
    // The account's newest entry by start, running or stopped, in any
    // workspace, with project metadata: GET /api/app/time_entries/latest,
    // the first entry GET /me/time_entries?meta=true lists. None for an
    // account without entries.
    void fetchLatestEntry(Callback<std::optional<ListedEntry>> done = {});
    // The Pomodoro lengths of the account preferences, through
    // /api/app/me/preferences, whose refusals name the refused key in
    // Tokkl-Error-Field. A length outside the server's pomodoro_limits reads
    // as the server's default.
    void fetchPreferences(Callback<PomodoroConfig> done = {});
    // Posts only the lengths the update sets, on the same path as
    // fetchPreferences(). done gets the lengths the server holds
    // afterwards.
    void savePreferences(const PomodoroConfigUpdate &update, Callback<PomodoroConfig> done = {});

    // The account's timer state, GET /api/app/timer. Like /me, a 401 or 403
    // means the credentials were refused.
    void fetchTimerState(Callback<TimerState> done = {});
    // The timer actions. Each needs canWrite(), and done tells apart a change
    // made, a 409 with the server's state, nothing changed, and an unknown
    // outcome. Pause, resume, discard, next phase, end and a Pomodoro start
    // apply only to the state at revision, the one the user saw. A Pomodoro
    // start carries an Idempotency-Key of its own, and one whose outcome is
    // unknown goes out once more with it after a short wait
    // (ApiClient::keyedAction()).
    void pauseTimer(qint64 revision, ActionCallback done = {});
    void resumeTimer(qint64 revision, ActionCallback done = {});
    void discardPause(qint64 revision, ActionCallback done = {});
    void startPomodoro(qint64 revision, const PomodoroStart &start, ActionCallback done = {});
    void nextPomodoroPhase(qint64 revision, ActionCallback done = {});
    void endPomodoro(qint64 revision, ActionCallback done = {});
    // Start a running entry and stop the running one through POST
    // /api/app/timer/start and /api/app/timer/stop, like the actions above:
    // a 409 brings the server's state when the timer changed since
    // revision, or for a stop when nothing runs. A start carries an
    // Idempotency-Key like a Pomodoro start.
    void startTimer(qint64 revision, const StartEntry &entry, ActionCallback done = {});
    void stopTimer(qint64 revision, ActionCallback done = {});
    // Edits the running entry entryId through POST /api/app/timer/edit; only
    // the fields update sets travel, and start never does. A change to the
    // timer that leaves the entry running does not refuse it. A 409 brings
    // the server's state once the entry has stopped.
    void editTimer(qint64 entryId, const TimeEntryUpdate &update, ActionCallback done = {});
    // Opens GET /api/app/timer/events, or returns nullptr without a bound
    // account or during a 429 cooldown. The caller reads the stream's
    // signals; the connection deletes it after finished(). A new generation
    // aborts it. A refusal ends it as for the current entry: a 401 or 403
    // refuses the credentials and a 429 starts the cooldown. A clean end, a
    // failure or another status changes nothing here.
    PendingStream *openTimerEvents();

    // Projects per page, the server's maximum, and the most pages read.
    static constexpr int projectPageSize = 200;
    static constexpr int maxProjectPages = 100;

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

private:
    struct Context {
        quint64 generation = 0;
        Me me;
    };
    // The GET /api/app/status of one generation. A failed read leaves
    // server empty, which is below the floor.
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
    // Reads the preferences with the limits of the server bound.
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
