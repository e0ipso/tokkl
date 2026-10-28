// Runs the QML tests in autotests/qml against the widget's panel components
// and its Configure page. The backend types are registered from tokklcore
// under the backend URI, and a PanelFixture wires them to the scripted
// transport, credential store and clock from fakes.h, with a timer and a
// Pomodoro session that share one timer state client and keep the mode in a
// temporary QSettings file.
// The Configure pages' TokklConnectionSetup and TokklPomodoroLengths use
// another such transport and store, which a WalletFixture controls, and
// their TokklAlarm plays the core's copies of the sounds. Nothing reaches a
// host, KDE Wallet or real settings.

#include "alarmplayer.h"
#include "connection.h"
#include "connectionsetup.h"
#include "fakes.h"
#include "pomodorolengthsclient.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosoundcatalogue.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstateclient.h"

#include <Kirigami/Platform/Units>
#include <KLocalizedQmlContext>
#include <KLocalizedString>

#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QGuiApplication>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QSet>
#include <QSettings>
#include <QTemporaryDir>
#include <QUrlQuery>
#include <QtQuickTest>

using namespace Tokkl;

class PanelFixture : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::TimerController *timer READ timer CONSTANT)
    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroSession *session READ session CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences CONSTANT)
    Q_PROPERTY(int requestCount READ requestCount)

public:
    explicit PanelFixture(QObject *parent = nullptr)
        : QObject(parent)
    {
        m_timer.setStateClient(&m_client);
    }

    TimerController *timer()
    {
        return &m_timer;
    }

    Connection *connection()
    {
        return &m_connection;
    }

    PomodoroSession *session()
    {
        return &m_session;
    }

    PomodoroPreferences *preferences()
    {
        return &m_preferences;
    }

    int requestCount() const
    {
        return int(m_transport.requests.size());
    }

    // Stores a token for the instance and selects it, as the Configure page
    // would. The connection then reads the secret and asks for /me.
    Q_INVOKABLE void configure(const QString &url, const QString &token)
    {
        m_store.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        m_connection.setInstanceUrl(url);
    }

    // The newest unanswered request with this method whose API path, after
    // /api/v9, ends with the suffix; -1 when there is none.
    Q_INVOKABLE int pending(const QString &method, const QString &suffix) const
    {
        for (qsizetype i = m_transport.requests.size() - 1; i >= 0; --i) {
            const HttpRequest &request = m_transport.requests.at(i);
            if (!m_answered.contains(i) && request.method == method.toUtf8() && request.url.path().endsWith(suffix)) {
                return int(i);
            }
        }
        return -1;
    }

    // method, path, query (a map), body (parsed JSON, or the raw text), and
    // whether it carried credentials.
    Q_INVOKABLE QVariantMap request(int index) const
    {
        const HttpRequest &request = m_transport.requests.at(index);
        QVariantMap query;
        for (const auto &[key, value] : QUrlQuery(request.url).queryItems()) {
            query.insert(key, value);
        }
        const QJsonDocument json = QJsonDocument::fromJson(request.body);
        return {
            {QStringLiteral("method"), QString::fromUtf8(request.method)},
            {QStringLiteral("path"), request.url.path()},
            {QStringLiteral("query"), query},
            {QStringLiteral("body"), json.isNull() ? QVariant(QString::fromUtf8(request.body)) : json.toVariant()},
            {QStringLiteral("authorized"), !request.authorization.isEmpty()},
        };
    }

    Q_INVOKABLE void respond(int index, int status, const QString &body)
    {
        m_answered.insert(index);
        m_transport.respond(index, FakeTransport::answer(status, body.toUtf8()));
    }

    // No HTTP answer, as when the network is down.
    Q_INVOKABLE void failNetwork(int index)
    {
        m_answered.insert(index);
        m_transport.respond(index, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("unreachable")));
    }

    // Sends a state to the open event stream, as the server does when the
    // state changes. False when no stream is open.
    Q_INVOKABLE bool push(const QString &body)
    {
        FakeStream *stream = m_transport.lastStream();
        if (!stream) {
            return false;
        }
        stream->push("event: timer\ndata: " + body.toUtf8() + "\n\n");
        return true;
    }

    // The fake clock's time as an RFC 3339 UTC string, shifted by seconds.
    Q_INVOKABLE QString clockIso(int offsetSeconds = 0) const
    {
        return m_clock.current.addSecs(offsetSeconds).toString(Qt::ISODate);
    }

    // The item's window is the application's focus window.
    Q_INVOKABLE bool hasFocusWindow(QQuickItem *item) const
    {
        return item && item->window() && QGuiApplication::focusWindow() == item->window();
    }

    Q_INVOKABLE void advance(int ms)
    {
        m_clock.advance(ms);
    }

    // Sets Kirigami.Units.longDuration for the engine, as Plasma's Animation
    // speed setting does (1 at "Instant"). Returns the value before.
    Q_INVOKABLE int setLongDuration(int ms)
    {
        QQmlEngine *engine = qmlEngine(this);
        auto *units = engine ? engine->singletonInstance<Kirigami::Platform::Units *>("org.kde.kirigami.platform", "Units") : nullptr;
        if (!units) {
            return -1;
        }
        const int before = units->longDuration();
        units->setLongDuration(ms);
        return before;
    }

private:
    FakeTransport m_transport;
    FakeCredentialStore m_store;
    FakeClock m_clock;
    Connection m_connection{&m_transport, &m_store, testClientName()};
    TimerStateClient m_client{&m_connection, &m_clock};
    TimerController m_timer{&m_clock};
    QTemporaryDir m_dir;
    QSettings m_settings{m_dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
    SettingsPomodoroStore m_pomodoroStore{&m_settings};
    PomodoroPreferences m_preferences{&m_connection};
    // Last, so it goes first: it still reads the others while it ends.
    PomodoroSession m_session{&m_clock, &m_timer, &m_client, &m_pomodoroStore};
    QSet<qsizetype> m_answered;
};

// The transport and store behind every TokklConnectionSetup the Configure
// page makes. They live as long as the process.
FakeTransport *setupTransport()
{
    static auto *transport = new FakeTransport;
    return transport;
}

FakeCredentialStore *setupStore()
{
    static auto *store = new FakeCredentialStore;
    return store;
}

// The page's TokklConnectionSetup, created from QML as the widget's is.
class FakeConnectionSetup : public ConnectionSetup
{
    Q_OBJECT

public:
    explicit FakeConnectionSetup(QObject *parent = nullptr)
        : ConnectionSetup(setupTransport(), setupStore(), parent)
    {
    }
};

// The requests of setupTransport() that a test has answered.
QSet<qsizetype> &setupAnswered()
{
    static QSet<qsizetype> answered;
    return answered;
}

// The Pomodoro page's TokklPomodoroLengths, on the same transport and store.
class FakePomodoroLengths : public PomodoroLengthsClient
{
    Q_OBJECT

public:
    explicit FakePomodoroLengths(QObject *parent = nullptr)
        : PomodoroLengthsClient(new Connection(setupTransport(), setupStore(), testClientName()), parent)
    {
    }
};

// The Pomodoro page's TokklAlarm. It plays the core's copies of the sounds,
// as no widget is installed.
class FakeAlarm : public AlarmPlayer
{
    Q_OBJECT

public:
    explicit FakeAlarm(QObject *parent = nullptr)
        : AlarmPlayer(parent)
    {
        const QString sound = QString::fromUtf8(TOKKL_POMODORO_SOUND_FILES).section(QLatin1Char('|'), 0, 0);
        setSoundsDirectory(QFileInfo(sound).absolutePath());
    }
};

// Scripts the wallet and the network behind the Configure pages.
class WalletFixture : public QObject
{
    Q_OBJECT

    Q_PROPERTY(int writes READ writes)

public:
    using QObject::QObject;

    int writes() const
    {
        return setupStore()->writes;
    }

    // Reads and writes are refused as by a locked wallet, or work again.
    Q_INVOKABLE void setRefused(bool refused)
    {
        setupStore()->failure = refused ? CredentialResult::Status::Unavailable : CredentialResult::Status::Ok;
    }

    // Empties the wallet and forgets the requests. Replies to forgotten
    // requests are never delivered.
    Q_INVOKABLE void reset()
    {
        setRefused(false);
        setupStore()->secrets.clear();
        setupStore()->writes = 0;
        setupTransport()->requests.clear();
        setupTransport()->replies.clear();
        setupAnswered().clear();
    }

    // Stores a token for the instance, as the Connection page would.
    Q_INVOKABLE void storeToken(const QString &url, const QString &token)
    {
        setupStore()->secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
    }

    // The newest unanswered request with this method whose path ends with
    // the suffix; -1 when there is none.
    Q_INVOKABLE int pending(const QString &method, const QString &suffix) const
    {
        const QList<HttpRequest> &requests = setupTransport()->requests;
        for (qsizetype i = requests.size() - 1; i >= 0; --i) {
            if (!setupAnswered().contains(i) && requests.at(i).method == method.toUtf8() && requests.at(i).url.path().endsWith(suffix)) {
                return int(i);
            }
        }
        return -1;
    }

    // The request's body, parsed as JSON.
    Q_INVOKABLE QVariant requestBody(int index) const
    {
        return QJsonDocument::fromJson(setupTransport()->requests.at(index).body).toVariant();
    }

    Q_INVOKABLE void respond(int index, int status, const QString &body)
    {
        setupAnswered().insert(index);
        setupTransport()->respond(index, FakeTransport::answer(status, body.toUtf8()));
    }

    // No HTTP answer, as when the network is down.
    Q_INVOKABLE void failNetwork(int index)
    {
        setupAnswered().insert(index);
        setupTransport()->respond(index, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("unreachable")));
    }

    // The token stored for the instance, or an empty string.
    Q_INVOKABLE QString storedToken(const QString &url) const
    {
        return setupStore()->secrets.value(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()));
    }

    // The page's connection setup.
    Q_INVOKABLE QObject *setupOf(QObject *page) const
    {
        return page ? page->findChild<ConnectionSetup *>() : nullptr;
    }

    // The Pomodoro page's lengths client and sound player.
    Q_INVOKABLE QObject *lengthsOf(QObject *page) const
    {
        return page ? page->findChild<PomodoroLengthsClient *>() : nullptr;
    }

    Q_INVOKABLE QObject *playerOf(QObject *page) const
    {
        return page ? page->findChild<AlarmPlayer *>() : nullptr;
    }
};

class Setup : public QObject
{
    Q_OBJECT

public Q_SLOTS:
    void qmlEngineAvailable(QQmlEngine *engine)
    {
        // The backend URI must resolve to these registrations, never to a
        // build or installed copy of the plugin found on the import path.
        const QString moduleDir = QStringLiteral(TOKKL_BACKEND_URI).replace(QLatin1Char('.'), QLatin1Char('/'));
        QStringList paths = engine->importPathList();
        paths.removeIf([&moduleDir](const QString &path) {
            return QFileInfo::exists(path + QLatin1Char('/') + moduleDir + QStringLiteral("/qmldir"));
        });
        engine->setImportPathList(paths);

        const char *uri = TOKKL_BACKEND_URI;
        qmlRegisterUncreatableType<Connection>(uri, 1, 0, "TokklConnection", QStringLiteral("Created by PanelFixture"));
        qmlRegisterUncreatableType<TimerController>(uri, 1, 0, "TokklTimer", QStringLiteral("Created by PanelFixture"));
        qmlRegisterUncreatableType<PomodoroSession>(uri, 1, 0, "TokklPomodoroSession", QStringLiteral("Created by PanelFixture"));
        qmlRegisterType<FakeConnectionSetup>(uri, 1, 0, "TokklConnectionSetup");
        qmlRegisterUncreatableType<PomodoroPreferences>(uri, 1, 0, "TokklPomodoroPreferences", QStringLiteral("Created by TokklPomodoroLengths"));
        qmlRegisterType<FakePomodoroLengths>(uri, 1, 0, "TokklPomodoroLengths");
        qmlRegisterType<FakeAlarm>(uri, 1, 0, "TokklAlarm");
        qmlRegisterSingletonType<PomodoroSoundCatalogue>(uri, 1, 0, "TokklPomodoroSounds", [](QQmlEngine *, QJSEngine *) -> QObject * {
            return new PomodoroSoundCatalogue;
        });
        qmlRegisterType<PanelFixture>("Tokkl.Test", 1, 0, "PanelFixture");
        qmlRegisterType<WalletFixture>("Tokkl.Test", 1, 0, "WalletFixture");

        // Plasma sets the widget's domain the same way.
        KLocalizedString::setApplicationDomain(QByteArrayLiteral("plasma_applet_" TOKKL_PLASMOID_ID));
        KLocalization::setupLocalizedContext(engine);
    }
};

QUICK_TEST_MAIN_WITH_SETUP(panel, Setup)

#include "panelquicktest.moc"
