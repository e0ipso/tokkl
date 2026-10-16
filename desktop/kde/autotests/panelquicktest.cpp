// Runs the QML tests in autotests/qml against the widget's panel components.
// The backend types are registered from tokklcore under the backend URI, and
// a PanelFixture wires them to the scripted transport, credential store and
// clock from fakes.h. Nothing reaches a host, KDE Wallet or real settings.

#include "connection.h"
#include "fakes.h"
#include "timercontroller.h"

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
#include <QUrlQuery>
#include <QtQuickTest>

using namespace Tokkl;

class PanelFixture : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::TimerController *timer READ timer CONSTANT)
    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)
    Q_PROPERTY(int requestCount READ requestCount)

public:
    explicit PanelFixture(QObject *parent = nullptr)
        : QObject(parent)
    {
        m_timer.setConnection(&m_connection);
    }

    TimerController *timer()
    {
        return &m_timer;
    }

    Connection *connection()
    {
        return &m_connection;
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

private:
    FakeTransport m_transport;
    FakeCredentialStore m_store;
    FakeClock m_clock;
    Connection m_connection{&m_transport, &m_store};
    TimerController m_timer{&m_clock};
    QSet<qsizetype> m_answered;
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
        qmlRegisterType<PanelFixture>("Tokkl.Test", 1, 0, "PanelFixture");

        // Plasma sets the widget's domain the same way.
        KLocalizedString::setApplicationDomain(QByteArrayLiteral("plasma_applet_" TOKKL_PLASMOID_ID));
        KLocalization::setupLocalizedContext(engine);
    }
};

QUICK_TEST_MAIN_WITH_SETUP(panel, Setup)

#include "panelquicktest.moc"
