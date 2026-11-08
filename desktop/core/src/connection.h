#pragma once

#include "apiclient.h"
#include "apitypes.h"
#include "authsession.h"
#include "cooldown.h"
#include "credentialstore.h"
#include "transport.h"

#include <QDateTime>
#include <QObject>
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
// Settings come from the widget configuration (instanceUrl, authMode, email).
// AuthSession reads the secret, validates the account, keeps the connection
// state and starts a new generation whenever a setting or the stored secret
// changes; ApiClient sends the requests. Connection adds the typed
// operations, which all use the bound account's default workspace.
class Connection : public QObject
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

    Q_PROPERTY(Tokkl::AuthSession::State state READ state NOTIFY stateChanged)
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
    // The states are AuthSession's; Connection::Connected names the same
    // value as AuthSession::Connected.
    using State = AuthSession::State;
#ifndef Q_MOC_RUN
    using enum AuthSession::State;
#endif

    template<typename T>
    using Callback = ApiClient::Callback<T>;
    using ActionCallback = ApiClient::ActionCallback;

    // Uses the given transport and store; the connection does not own them.
    // clientName goes into the created_with field of the entries it starts.
    Connection(Transport *transport, CredentialStore *store, const QString &clientName, QObject *parent = nullptr);

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
    quint64 generation() const;

    std::optional<Me> account() const;
    QVariantMap accountMap() const;
    qint64 workspaceId() const;
    // The instance, account and workspace of the validated account as one
    // key, for what a device keeps per account. Empty without one.
    QString owner() const;

    // Typed operations. They need a bound account, use its workspace, and
    // refuse while a 429 cooldown runs. The connection keeps nothing of
    // their answers but the account from /me. done runs later, and only for
    // a reply of the current generation.
    void fetchMe(Callback<Me> done = {});
    // Every active project of the workspace, following the pages up to
    // maxProjectPages. A workspace beyond that still succeeds with the
    // projects read, and the list says it is cut short.
    void fetchProjects(Callback<ProjectList> done = {});
    // One project of the workspace, archived or not.
    void fetchProject(qint64 projectId, Callback<Project> done = {});
    // The account's entries of the last 9 days in every workspace, newest
    // first, with project metadata (GET /me/time_entries?meta=true).
    void fetchRecentEntries(Callback<QList<ListedEntry>> done = {});
    // The v9 start and stop of a running entry. startTimer() and
    // stopTimer() use them on a server without the app routes.
    void startEntry(const StartEntry &entry, Callback<TimeEntry> done = {});
    void stopEntry(qint64 entryId, Callback<TimeEntry> done = {});
    void updateEntry(qint64 entryId, const TimeEntryUpdate &update, Callback<TimeEntry> done = {});
    // The Pomodoro lengths of the account preferences, through
    // /api/app/me/preferences, whose refusals name the refused key in
    // Tokkl-Error-Field. A server from before that route answers 404; the
    // request then goes to /api/v9/me/preferences, and so does every later
    // one of this generation.
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
    // outcome. Resume, discard, next phase and end apply only to the state
    // at revision, the one the user saw.
    void pauseTimer(ActionCallback done = {});
    void resumeTimer(qint64 revision, ActionCallback done = {});
    void discardPause(qint64 revision, ActionCallback done = {});
    void startPomodoro(const PomodoroStart &start, ActionCallback done = {});
    void nextPomodoroPhase(qint64 revision, ActionCallback done = {});
    void endPomodoro(qint64 revision, ActionCallback done = {});
    // Start a running entry and stop the running one through POST
    // /api/app/timer/start and /api/app/timer/stop, like the actions above:
    // a 409 brings the server's state when the timer changed since
    // revision, or for a stop when nothing runs. A server from before those
    // routes answers 404: the write then goes to startEntry() or
    // stopEntry(entryId), whose reply is the entry (TimerActionResult::entry)
    // rather than the state, and so does every later start and stop of this
    // generation. When the v9 route answers 404 as well, the app route was
    // there and refused the write (a project or entry gone), so the next
    // write tries it again.
    void startTimer(qint64 revision, const StartEntry &entry, ActionCallback done = {});
    void stopTimer(qint64 revision, qint64 entryId, ActionCallback done = {});
    // Opens GET /api/app/timer/events, or returns nullptr without a bound
    // account or during a 429 cooldown. The caller reads the stream's
    // signals; the connection deletes it after finished(). A new generation
    // aborts it. A refusal ends it as for the current entry: a 401 or 403
    // refuses the credentials and a 429 starts the cooldown. A clean end, a
    // failure or another status changes nothing here.
    PendingStream *openTimerEvents();

    // Delay before an automatic retry after a connectivity failure, plus up
    // to retryJitterMs more at random, and the cooldown after a 429 without
    // Retry-After.
    static constexpr int retryDelayMs = AuthSession::retryDelayMs;
    static constexpr int retryJitterMs = AuthSession::retryJitterMs;
    static constexpr int defaultCooldownMs = Cooldown::defaultMs;
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
    struct ProjectPages;
    void fetchProjectPage(const std::shared_ptr<ProjectPages> &pages);
    QUrl api(const QString &path) const;
    QUrl app(const QString &path) const;
    // The preferences go through v9 in this generation.
    bool preferencesThroughV9() const;
    // Sends a preferences request through the app path, or through v9 once
    // the app path answered 404 in this generation.
    void preferencesCall(const QByteArray &method, const QByteArray &body, ApiAccess access, Callback<PomodoroConfig> done);
    // A start or stop through /api/app + path, or through v9 once that
    // answered 404 in this generation; see startTimer().
    using V9Write = std::function<void(Connection &, Callback<TimeEntry>)>;
    void timerWrite(const QString &path, const QByteArray &body, V9Write v9, ActionCallback done);

    const QString m_clientName;
    AuthSession m_session;
    // The generation in which /api/app/me/preferences answered 404.
    std::optional<quint64> m_v9PreferencesGeneration;
    // The generation in which /api/app/timer/start or /stop answered 404
    // and the v9 route did not.
    std::optional<quint64> m_v9TimerWritesGeneration;
};

}
