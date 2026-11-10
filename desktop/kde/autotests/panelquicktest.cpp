// Nothing here reaches a host, KDE Wallet or real settings.

#include "alarmplayer.h"
#include "connection.h"
#include "connectionsetup.h"
#include "fakes.h"
#include "menuactions.h"
#include "statuspresentation.h"
#include "pomodorolengthssaves.h"
#include "pomodorolengthsclient.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosoundcatalogue.h"
#include "pomodorostore.h"
#include "timercontroller.h"
#include "timerstack.h"

#include <Kirigami/Platform/Units>
#include <KLocalizedQmlContext>
#include <KLocalizedString>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
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
    Q_PROPERTY(int catalogChecks READ catalogChecks)

public:
    explicit PanelFixture(QObject *parent = nullptr)
        : QObject(parent)
    {
        m_transport.status = FakeTransport::currentStatus();
    }

    TimerController *timer()
    {
        return m_stack.timer();
    }

    Connection *connection()
    {
        return m_stack.connection();
    }

    PomodoroSession *session()
    {
        return m_stack.session();
    }

    PomodoroPreferences *preferences()
    {
        return m_stack.preferences();
    }

    int requestCount() const
    {
        return int(m_transport.requests.size());
    }

    int catalogChecks() const
    {
        return int(m_transport.catalogRequests.size());
    }

    Q_INVOKABLE QVariantMap statusFixture() const
    {
        QFile file(QStringLiteral(TOKKL_STATUS_FIXTURE));
        if (!file.open(QIODevice::ReadOnly)) {
            return QVariantMap();
        }
        return QJsonDocument::fromJson(file.readAll()).object().toVariantMap();
    }

    Q_INVOKABLE void changeCatalog()
    {
        m_transport.catalog = FakeTransport::catalogAt(++m_catalogRevision);
    }

    // Catalog checks wait unanswered until failCatalogChecks().
    Q_INVOKABLE void holdCatalogChecks()
    {
        m_transport.holdCatalog = true;
        m_heldCatalogFrom = m_transport.catalogReplies.size();
    }

    Q_INVOKABLE void failCatalogChecks()
    {
        for (qsizetype i = m_heldCatalogFrom; i < m_transport.catalogReplies.size(); ++i) {
            m_transport.respondCatalog(i, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("unreachable")));
        }
        m_transport.holdCatalog = false;
    }

    Q_INVOKABLE void configure(const QString &url, const QString &token)
    {
        m_store.secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
        m_stack.connection()->setInstanceUrl(url);
    }

    // API path after /api/v9; -1 when there is none.
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

    Q_INVOKABLE void failNetwork(int index)
    {
        m_answered.insert(index);
        m_transport.respond(index, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("unreachable")));
    }

    Q_INVOKABLE bool push(const QString &body)
    {
        FakeStream *stream = m_transport.lastStream();
        if (!stream) {
            return false;
        }
        stream->push("event: timer\ndata: " + body.toUtf8() + "\n\n");
        return true;
    }

    Q_INVOKABLE QString clockIso(int offsetSeconds = 0) const
    {
        return m_clock.current.addSecs(offsetSeconds).toString(Qt::ISODate);
    }

    Q_INVOKABLE bool hasFocusWindow(QQuickItem *item) const
    {
        return item && item->window() && QGuiApplication::focusWindow() == item->window();
    }

    Q_INVOKABLE void advance(int ms)
    {
        m_clock.advance(ms);
    }

    // Plasma's Animation speed sets it to 1 at "Instant".
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
    qint64 m_catalogRevision = 1;
    qsizetype m_heldCatalogFrom = 0;
    FakeCredentialStore m_store;
    FakeClock m_clock;
    QTemporaryDir m_dir;
    QSettings m_settings{m_dir.filePath(QStringLiteral("pomodoro.ini")), QSettings::IniFormat};
    SettingsPomodoroStore m_pomodoroStore{&m_settings};
    // After the fakes, so it is destroyed first.
    TimerStack m_stack{&m_transport, &m_store, m_pomodoroStore, m_clock, testClientName()};
    QSet<qsizetype> m_answered;
};

// Live as long as the process.
FakeTransport *setupTransport()
{
    static auto *transport = [] {
        auto *made = new FakeTransport;
        made->status = FakeTransport::currentStatus();
        return made;
    }();
    return transport;
}

FakeCredentialStore *setupStore()
{
    static auto *store = new FakeCredentialStore;
    return store;
}

FakeClock *setupClock()
{
    static auto *clock = new FakeClock;
    return clock;
}

class FakeConnectionSetup : public ConnectionSetup
{
    Q_OBJECT

public:
    explicit FakeConnectionSetup(QObject *parent = nullptr)
        : ConnectionSetup(setupTransport(), setupStore(), parent)
    {
    }
};

QSet<qsizetype> &setupAnswered()
{
    static QSet<qsizetype> answered;
    return answered;
}

class FakePomodoroLengths : public PomodoroLengthsClient
{
    Q_OBJECT

public:
    explicit FakePomodoroLengths(QObject *parent = nullptr)
        : PomodoroLengthsClient(new Connection(setupTransport(), setupStore(), *setupClock(), testClientName()), parent)
    {
    }
};

// Plays the core's copies of the sounds, as no widget is installed.
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

    Q_INVOKABLE void setRefused(bool refused)
    {
        setupStore()->failure = refused ? CredentialResult::Status::Unavailable : CredentialResult::Status::Ok;
    }

    // Replies to forgotten requests are never delivered.
    Q_INVOKABLE void reset()
    {
        setRefused(false);
        setupStore()->secrets.clear();
        setupStore()->writes = 0;
        setupTransport()->requests.clear();
        setupTransport()->replies.clear();
        setupAnswered().clear();
    }

    Q_INVOKABLE void storeToken(const QString &url, const QString &token)
    {
        setupStore()->secrets.insert(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()), token);
    }

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

    Q_INVOKABLE QVariant requestBody(int index) const
    {
        return QJsonDocument::fromJson(setupTransport()->requests.at(index).body).toVariant();
    }

    Q_INVOKABLE void respond(int index, int status, const QString &body)
    {
        setupAnswered().insert(index);
        setupTransport()->respond(index, FakeTransport::answer(status, body.toUtf8()));
    }

    Q_INVOKABLE void refuse(int index, const QString &field, const QString &body)
    {
        setupAnswered().insert(index);
        HttpResponse response = FakeTransport::answer(400, body.toUtf8());
        response.errorField = field.toLatin1();
        setupTransport()->respond(index, response);
    }

    Q_INVOKABLE void failNetwork(int index)
    {
        setupAnswered().insert(index);
        setupTransport()->respond(index, FakeTransport::failure(HttpResponse::Outcome::NetworkError, QStringLiteral("unreachable")));
    }

    Q_INVOKABLE QString storedToken(const QString &url) const
    {
        return setupStore()->secrets.value(credentialKey(parseInstanceUrl(url), AuthMode::Token, QString()));
    }

    Q_INVOKABLE QObject *setupOf(QObject *page) const
    {
        return page ? page->findChild<ConnectionSetup *>() : nullptr;
    }

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
        qmlRegisterType<MenuActions>(uri, 1, 0, "TokklMenuActions");
        qmlRegisterType<StatusParts>(uri, 1, 0, "TokklStatusParts");
        qmlRegisterType<FakeConnectionSetup>(uri, 1, 0, "TokklConnectionSetup");
        qmlRegisterUncreatableType<PomodoroPreferences>(uri, 1, 0, "TokklPomodoroPreferences", QStringLiteral("Created by TokklPomodoroLengths"));
        qmlRegisterType<FakePomodoroLengths>(uri, 1, 0, "TokklPomodoroLengths");
        qmlRegisterType<PomodoroLengthsSaveStatus>(uri, 1, 0, "TokklLengthsSaveStatus");
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
