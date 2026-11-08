#pragma once

#include "apiclient.h"
#include "apitypes.h"
#include "cooldown.h"
#include "credentialstore.h"
#include "instanceurl.h"
#include "sessioncredentials.h"

#include <QDateTime>
#include <QObject>
#include <QTimer>

#include <optional>

namespace Tokkl
{

// The authentication state of one configured instance and account.
//
// The settings name the instance, the sign-in mode and, for passwords, the
// email; the secret comes from the credential store. SessionCredentials
// holds both. GET /api/v9/me validates them and binds the account and its
// default workspace to the current generation. Before the first /me of a
// generation, GET /api/app/status reads what the server announces, so the
// routes are known once the account is bound. A failed or older answer
// announces nothing, and the account binds all the same. Until the server
// answers it, each later /me of the generation asks again first.
//
// Changing a setting or the stored secret starts a new generation: the
// account is cleared at once, requests in flight are aborted, and replies
// issued under an older generation are dropped.
//
// When the store refuses to write a secret for this account, also after the
// settings page that asked for it is gone, the session drops the account and
// reports WalletError, so the user learns that the secret was not saved.
//
// It is the ApiSession of its own ApiClient: it decides which requests may
// go out and what a failed answer does to the account.
class AuthSession : public QObject, public ApiSession
{
    Q_OBJECT

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

    // Delay before an automatic retry after a connectivity failure, plus up
    // to retryJitterMs more at random.
    static constexpr int retryDelayMs = 30000;
    static constexpr int retryJitterMs = 10000;

    // Uses the given transport and store; the session does not own them.
    AuthSession(Transport *transport, CredentialStore *store, QObject *parent = nullptr);

    QString instanceText() const;
    void setInstanceText(const QString &text);
    AuthMode authMode() const;
    void setAuthMode(AuthMode mode);
    QString email() const;
    void setEmail(const QString &email);
    // The parsed instance of the last reload; invalid before one.
    const InstanceUrl &instance() const;

    State state() const;
    QString errorString() const;
    // A validated account is bound to this generation.
    bool hasAccount() const;
    bool canWrite() const;
    QDateTime rateLimitedUntil() const;
    // The bound account, or nullopt.
    std::optional<Me> account() const;
    // What the server announced in this generation; nothing without a bound
    // account.
    ServerApi server() const;

    // The client for this session's requests.
    ApiClient &api();

    // GET /me as an Account call; a valid answer binds the account.
    void fetchMe(ApiClient::Callback<Me> done);

    // Explicit reconnect: reads the secret again and validates it, also after
    // an authentication failure. A 429 cooldown still applies.
    void reconnect();
    // Automatic revalidation through /me. Does nothing while authentication
    // is paused.
    void refreshAccount();

    // ApiSession
    quint64 generation() const override;
    QByteArray authorization() const override;
    std::optional<ApiError> refusal(ApiAccess access) const override;
    void answered() override;
    bool absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access) override;

Q_SIGNALS:
    void instanceTextChanged();
    void authModeChanged();
    void emailChanged();
    void stateChanged();
    void accountChanged();
    // The account went with its generation, after accountChanged() and
    // stateChanged() and before generationChanged(). What was chosen for
    // that account goes with it.
    void accountCleared();
    void generationChanged();

private:
    struct Context {
        quint64 generation = 0;
        Me me;
    };
    // The GET /api/app/status of one generation. known once the server
    // answered it; no answer, a timeout or a 5xx leaves it unknown.
    struct Announcement {
        quint64 generation = 0;
        bool pending = false;
        bool known = false;
        ServerApi server;
    };

    void settingsChanged();
    void scheduleReload();
    void reload();
    void onSecretRead(const CredentialResult &result);
    void showFailedWrite(CredentialResult::Status status);
    void authenticate(bool explicitRequest);
    void readAnnouncement();
    void sendMe();
    void handleMe(const HttpResponse &response);
    void refuseCredentials(const ApiError &error);
    void pauseAuthentication(const QString &message);
    void bind(const Me &me);
    void resetAccount();
    void clearAccount();
    void setState(State state, const QString &error = QString());
    void startCooldown(const QByteArray &retryAfter, const QString &message);
    void onCooldownEnded();

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
    ApiClient m_api;
};

}
