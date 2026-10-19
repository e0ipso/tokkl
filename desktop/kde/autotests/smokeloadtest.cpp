// Loads the staged install the way Plasma does: the widget package from the
// data dirs and the backend from the QML import path. The CTest fixture
// stages the install and points XDG_DATA_DIRS and QML_IMPORT_PATH at it.
//
// scripts/check-package.sh runs the same binary against an installed
// package: TOKKL_SMOKE_PLASMOID_DIR and TOKKL_SMOKE_BACKEND_DIR then name the
// installed widget and backend directories that Plasma must resolve.

#include <KConfigLoader>
#include <KLocalizedContext>
#include <KPackage/Package>
#include <KPackage/PackageLoader>
#include <Plasma/Applet>
#include <Plasma/Containment>
#include <Plasma/Corona>
#include <PlasmaQuick/AppletQuickItem>
#include <PlasmaQuick/ConfigView>

#include <QDir>
#include <QFileInfo>
#include <QIcon>
#include <QMetaProperty>
#include <QRegularExpression>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickWindow>
#include <QStandardPaths>
#include <QStringList>
#include <QTest>

#include <memory>

namespace
{
const QString plasmoidId = QStringLiteral(TOKKL_PLASMOID_ID);
const QString backendUri = QStringLiteral(TOKKL_BACKEND_URI);
const QString version = QStringLiteral(TOKKL_VERSION_STRING);
QString expectedDir(const char *variable, const QString &staged)
{
    const QString value = qEnvironmentVariable(variable);
    return value.isEmpty() ? staged : value;
}
const QString stagedPlasmoidDir = expectedDir("TOKKL_SMOKE_PLASMOID_DIR", QStringLiteral(TOKKL_STAGED_PLASMOID_DIR));
const QString stagedBackendDir = expectedDir("TOKKL_SMOKE_BACKEND_DIR", QStringLiteral(TOKKL_STAGED_BACKEND_DIR));

// QML errors from our package or backend; Qt reports them as warnings.
QStringList qmlProblems;
QtMessageHandler previousHandler = nullptr;

void collectQmlProblems(QtMsgType type, const QMessageLogContext &context, const QString &message)
{
    const QString category = QString::fromLatin1(context.category ? context.category : "");
    const bool fromQml = category == QLatin1String("qml") || category == QLatin1String("js");
    const bool ours = message.contains(plasmoidId);
    if (type != QtDebugMsg && type != QtInfoMsg && (fromQml || ours)) {
        qmlProblems.append(message);
    }
    previousHandler(type, context, message);
}

// Plasma writes cfg_instanceUrl to the configuration on Apply, so it holds
// only a validated address. The event loop never runs here, so the page
// never reads the wallet.
void checkPersistedUrl(QObject *page)
{
    QObject *urlField = nullptr;
    for (QObject *child : page->findChildren<QObject *>()) {
        if (child->property("placeholderText").toString() == QLatin1String("https://tokkl.example.com")) {
            urlField = child;
        }
    }
    QVERIFY(urlField);

    // The value Plasma passes in fills the field.
    QVERIFY(page->setProperty("cfg_instanceUrl", QStringLiteral("https://example.test/tokkl")));
    QCOMPARE(urlField->property("text").toString(), QStringLiteral("https://example.test/tokkl"));

    // Rejected addresses, credentials included, are never persisted, and the
    // field keeps what was typed.
    for (const QString &rejected : {QStringLiteral("https://user:password@example.test"),
                                    QStringLiteral("https://example.test/?password=hunter2"),
                                    QStringLiteral("https://example.test/#hunter2"),
                                    QStringLiteral("example.test")}) {
        urlField->setProperty("text", rejected);
        QCOMPARE(page->property("cfg_instanceUrl").toString(), QString());
        QCOMPARE(urlField->property("text").toString(), rejected);
    }

    // A valid address is persisted normalized, with its path prefix.
    urlField->setProperty("text", QStringLiteral(" HTTPS://Example.test:443/tokkl/ "));
    QCOMPARE(page->property("cfg_instanceUrl").toString(), QStringLiteral("https://example.test/tokkl"));
    // Typing is not rewritten under the cursor.
    QCOMPARE(urlField->property("text").toString(), QStringLiteral(" HTTPS://Example.test:443/tokkl/ "));

    urlField->setProperty("text", QString());
    QCOMPARE(page->property("cfg_instanceUrl").toString(), QString());
}
}

// The smallest shell that can host an applet: one screen and an empty
// containment, which Plasma creates when the requested plugin does not exist.
class TestCorona : public Plasma::Corona
{
public:
    QRect screenGeometry(int) const override
    {
        return QRect(0, 0, 1280, 800);
    }
};

class SmokeLoadTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        previousHandler = qInstallMessageHandler(collectQmlProblems);
        // Headless sessions have no desktop platform theme to select an
        // icon theme or its XDG search paths.
        QIcon::setThemeSearchPaths(QStandardPaths::locateAll(QStandardPaths::GenericDataLocation,
                                                           QStringLiteral("icons"), QStandardPaths::LocateDirectory));
        QIcon::setThemeName(QStringLiteral("hicolor"));
    }

    void cleanupTestCase()
    {
        qInstallMessageHandler(previousHandler);
    }

    void init()
    {
        qmlProblems.clear();
    }

    void stagedLayout()
    {
        QVERIFY(QFileInfo::exists(stagedPlasmoidDir + QStringLiteral("/metadata.json")));
        QVERIFY(QFileInfo::exists(stagedPlasmoidDir + QStringLiteral("/contents/ui/main.qml")));
        QVERIFY(QFileInfo::exists(stagedBackendDir + QStringLiteral("/qmldir")));
        QVERIFY(QFileInfo::exists(stagedBackendDir + QStringLiteral("/libtokklbackend.so")));
    }

    void packageMetadata()
    {
        const KPackage::Package package = KPackage::PackageLoader::self()->loadPackage(QStringLiteral("Plasma/Applet"), plasmoidId);
        QVERIFY(package.isValid());
        QCOMPARE(QDir(package.path()).canonicalPath(), QDir(stagedPlasmoidDir).canonicalPath());
        QCOMPARE(package.metadata().pluginId(), plasmoidId);
        QCOMPARE(package.metadata().version(), version);
        QCOMPARE(package.metadata().iconName(), plasmoidId);
        const QIcon icon = QIcon::fromTheme(package.metadata().iconName());
        QVERIFY(!icon.isNull());
        QCOMPARE(icon.pixmap(96, 96).toImage(), QPixmap(stagedPlasmoidDir + QStringLiteral("/contents/images/tokkl.png")).toImage());
        QCOMPARE(QFileInfo(package.filePath("mainscript")).canonicalFilePath(),
                 QFileInfo(stagedPlasmoidDir + QStringLiteral("/contents/ui/main.qml")).canonicalFilePath());
    }

    void backendModule()
    {
        QQmlEngine engine;
        // The first import path with the module wins; it must be the staged one.
        const QString moduleDir = QString(backendUri).replace(QLatin1Char('.'), QLatin1Char('/'));
        QString resolvedDir;
        for (const QString &importPath : engine.importPathList()) {
            const QString candidate = importPath + QLatin1Char('/') + moduleDir;
            if (QFileInfo::exists(candidate + QStringLiteral("/qmldir"))) {
                resolvedDir = candidate;
                break;
            }
        }
        QVERIFY2(!resolvedDir.isEmpty(), "the backend module is not on the QML import path");
        QCOMPARE(QDir(resolvedDir).canonicalPath(), QDir(stagedBackendDir).canonicalPath());

        QQmlComponent component(&engine);
        component.setData(QStringLiteral("import QtQml\nimport %1\nQtObject { readonly property string version: Companion.version }").arg(backendUri).toUtf8(),
                          QUrl());
        std::unique_ptr<QObject> object(component.create());
        QVERIFY2(object, qPrintable(component.errorString()));
        QCOMPARE(object->property("version").toString(), version);
        QVERIFY2(qmlProblems.isEmpty(), qPrintable(qmlProblems.join(QLatin1Char('\n'))));

        // The timer controller is a QML type; without a connection it is idle.
        QQmlComponent timerComponent(&engine);
        timerComponent.setData(QStringLiteral("import %1\nTokklTimer {}").arg(backendUri).toUtf8(), QUrl());
        std::unique_ptr<QObject> timer(timerComponent.create());
        QVERIFY2(timer, qPrintable(timerComponent.errorString()));
        QCOMPARE(timer->property("elapsedText").toString(), QStringLiteral("0:00:00"));
        QCOMPARE(timer->property("running").toBool(), false);
        QCOMPARE(timer->property("connected").toBool(), false);
        QCOMPARE(timer->property("canWrite").toBool(), false);
        QVERIFY2(qmlProblems.isEmpty(), qPrintable(qmlProblems.join(QLatin1Char('\n'))));
    }

    void appletLoads_data()
    {
        QTest::addColumn<bool>("desktop");
        QTest::newRow("panel") << false;
        QTest::newRow("desktop") << true;
    }

    void appletLoads()
    {
        QFETCH(bool, desktop);
        TestCorona corona;
        Plasma::Containment *containment = corona.createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);
        containment->setFormFactor(desktop ? Plasma::Types::Planar : Plasma::Types::Horizontal);
        containment->setLocation(desktop ? Plasma::Types::Floating : Plasma::Types::TopEdge);

        Plasma::Applet *applet = containment->createApplet(plasmoidId);
        QVERIFY(applet);
        QCOMPARE(applet->pluginMetaData().pluginId(), plasmoidId);
        QCOMPARE(applet->pluginMetaData().version(), version);

        PlasmaQuick::AppletQuickItem *item = PlasmaQuick::AppletQuickItem::itemForApplet(applet);
        QVERIFY(item);
        QVERIFY2(!applet->failedToLaunch(), qPrintable(applet->launchErrorMessage()));
        // main.qml reads this from the backend, so it proves the import resolved.
        QCOMPARE(item->property("toolTipSubText").toString(), QStringLiteral("Version %1").arg(version));
        // The timer is bound to the widget's connection and idle while unconfigured.
        auto *timer = item->property("timer").value<QObject *>();
        QVERIFY(timer);
        QCOMPARE(timer->property("connection").value<QObject *>(), item->property("connection").value<QObject *>());
        QCOMPARE(timer->property("elapsedText").toString(), QStringLiteral("0:00:00"));
        QCOMPARE(timer->property("canWrite").toBool(), false);
        // Let Plasma select and instantiate the visible representation.
        // Creating the component ourselves misses a compact view that
        // compiles but is never selected by the shell.
        const QSize size = desktop ? QSize(1000, 500) : QSize(240, 48);
        QQuickWindow window;
        window.resize(size);
        item->setParentItem(window.contentItem());
        item->setSize(size);
        window.show();
        QTRY_VERIFY_WITH_TIMEOUT(item->property("fullRepresentationItem").value<QQuickItem *>(), 1000);
        auto *panel = item->property("fullRepresentationItem").value<QQuickItem *>();
        QCOMPARE(panel->property("timer").value<QObject *>(), timer);
        auto *label = panel->findChild<QQuickItem *>(QStringLiteral("elapsedLabel"));
        QVERIFY(label);
        QCOMPARE(label->property("text").toString(), QStringLiteral("0:00:00"));
        QTRY_VERIFY(label->isVisible());
        QTRY_VERIFY(label->width() > 0 && label->height() > 0);
        QTRY_VERIFY(window.contentItem()->contains(label->mapToItem(window.contentItem(), label->boundingRect().center())));
        QVERIFY2(qmlProblems.isEmpty(), qPrintable(qmlProblems.join(QLatin1Char('\n'))));
    }

    // Ordinary configuration holds only nonsecret settings; the secret is
    // kept in KDE Wallet.
    void configSchema()
    {
        TestCorona corona;
        Plasma::Containment *containment = corona.createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);
        Plasma::Applet *applet = containment->createApplet(plasmoidId);
        QVERIFY(applet);
        KConfigLoader *scheme = applet->configScheme();
        QVERIFY(scheme);

        QStringList names;
        for (const KConfigSkeletonItem *item : scheme->items()) {
            names.append(item->name());
        }
        names.sort();
        QCOMPARE(names, QStringList({QStringLiteral("authMode"), QStringLiteral("email"), QStringLiteral("instanceUrl")}));
        QCOMPARE(scheme->property(QStringLiteral("instanceUrl")).toString(), QString());
        QCOMPARE(scheme->property(QStringLiteral("authMode")).toString(), QStringLiteral("token"));
    }

    void configPageLoads()
    {
        // Plasma opens the Configure dialog in a ConfigView. On Plasma 6.3
        // that view registers org.kde.plasma.configuration, which config.qml
        // imports; later releases install it as a QML module.
        TestCorona corona;
        Plasma::Containment *containment = corona.createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);
        Plasma::Applet *applet = containment->createApplet(plasmoidId);
        QVERIFY(applet);
        PlasmaQuick::ConfigView view(applet);
        // Only the pages' own QML problems count, not the view's.
        qmlProblems.clear();

        QQmlEngine engine;
        auto *localized = new KLocalizedContext(&engine);
        localized->setTranslationDomain(QStringLiteral("plasma_applet_") + plasmoidId);
        engine.rootContext()->setContextObject(localized);

        for (const QString &file : {QStringLiteral("/contents/config/config.qml"), QStringLiteral("/contents/ui/configGeneral.qml")}) {
            QQmlComponent component(&engine, QUrl::fromLocalFile(stagedPlasmoidDir + file));
            std::unique_ptr<QObject> object(component.create());
            QVERIFY2(object, qPrintable(component.errorString()));
            if (file.endsWith(QLatin1String("configGeneral.qml"))) {
                // Starts blank with token sign-in, and has no setting for the secret.
                QCOMPARE(object->property("cfg_instanceUrl").toString(), QString());
                QCOMPARE(object->property("cfg_authMode").toString(), QStringLiteral("token"));
                const QRegularExpression secretLike(QStringLiteral("token|password|secret"), QRegularExpression::CaseInsensitiveOption);
                const QMetaObject *meta = object->metaObject();
                for (int i = 0; i < meta->propertyCount(); ++i) {
                    const QString name = QString::fromLatin1(meta->property(i).name());
                    QVERIFY2(!name.startsWith(QLatin1String("cfg_")) || !secretLike.match(name).hasMatch(), qPrintable(name));
                }
                QVERIFY(meta->indexOfMethod("saveConfig()") >= 0);
                checkPersistedUrl(object.get());
            }
        }
        QVERIFY2(qmlProblems.isEmpty(), qPrintable(qmlProblems.join(QLatin1Char('\n'))));
    }
};

QTEST_MAIN(SmokeLoadTest)

#include "smokeloadtest.moc"
