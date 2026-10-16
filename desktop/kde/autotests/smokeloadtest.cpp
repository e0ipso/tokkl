// Loads the staged install the way Plasma does: the widget package from the
// data dirs and the backend from the QML import path. The CTest fixture
// stages the install and points XDG_DATA_DIRS and QML_IMPORT_PATH at it.

#include <KPackage/Package>
#include <KPackage/PackageLoader>
#include <Plasma/Applet>
#include <Plasma/Containment>
#include <Plasma/Corona>
#include <PlasmaQuick/AppletQuickItem>

#include <QDir>
#include <QFileInfo>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QStringList>
#include <QTest>

#include <memory>

namespace
{
const QString plasmoidId = QStringLiteral(TOKKL_PLASMOID_ID);
const QString backendUri = QStringLiteral(TOKKL_BACKEND_URI);
const QString version = QStringLiteral(TOKKL_VERSION_STRING);
const QString stagedPlasmoidDir = QStringLiteral(TOKKL_STAGED_PLASMOID_DIR);
const QString stagedBackendDir = QStringLiteral(TOKKL_STAGED_BACKEND_DIR);

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
    }

    void appletLoads()
    {
        TestCorona corona;
        Plasma::Containment *containment = corona.createContainment(QStringLiteral("tokkl.test.emptycontainment"));
        QVERIFY(containment);

        Plasma::Applet *applet = containment->createApplet(plasmoidId);
        QVERIFY(applet);
        QCOMPARE(applet->pluginMetaData().pluginId(), plasmoidId);
        QCOMPARE(applet->pluginMetaData().version(), version);

        PlasmaQuick::AppletQuickItem *item = PlasmaQuick::AppletQuickItem::itemForApplet(applet);
        QVERIFY(item);
        QVERIFY2(!applet->failedToLaunch(), qPrintable(applet->launchErrorMessage()));
        // main.qml reads this from the backend, so it proves the import resolved.
        QCOMPARE(item->property("toolTipSubText").toString(), QStringLiteral("Version %1").arg(version));
        QVERIFY2(qmlProblems.isEmpty(), qPrintable(qmlProblems.join(QLatin1Char('\n'))));
    }
};

QTEST_MAIN(SmokeLoadTest)

#include "smokeloadtest.moc"
