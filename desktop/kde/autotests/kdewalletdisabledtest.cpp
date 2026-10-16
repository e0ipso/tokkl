// KdeConnection and KdeConnectionSetup with KDE Wallet turned off in
// kwalletrc. KDE Wallet reads that setting once per process, so this runs
// apart from kdeconnection. The kwalletrc is in a temporary directory, and the
// session bus address leads nowhere, so no real wallet or setting is touched.

#include "kdeconnection.h"
#include "kwalletcredentialstore.h"

#include <QFile>
#include <QTemporaryDir>
#include <QTest>

#include <optional>

using namespace Tokkl;

namespace
{
const QString kdeDisabled =
    QStringLiteral("KDE Wallet is disabled. Enable it in System Settings to save Tokkl credentials; Tokkl does not store them anywhere else.");
const QString instance = QStringLiteral("https://example.test/tokkl");
}

class KdeWalletDisabledTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_home.isValid());
        qputenv("HOME", m_home.path().toLocal8Bit());
        qputenv("XDG_CONFIG_HOME", m_home.path().toLocal8Bit());
        qputenv("DBUS_SESSION_BUS_ADDRESS", QString(QStringLiteral("unix:path=") + m_home.filePath(QStringLiteral("no-bus"))).toLocal8Bit());
        QFile config(m_home.filePath(QStringLiteral("kwalletrc")));
        QVERIFY(config.open(QIODevice::WriteOnly));
        config.write("[Wallet]\nEnabled=false\n");
    }

    void storeReportsDisabled()
    {
        std::optional<CredentialResult> result;
        QObject context;
        KWalletCredentialStore::shared()->read(QStringLiteral("key"), &context, [&result](const CredentialResult &r) {
            result = r;
        });
        QTRY_VERIFY(result.has_value());
        QCOMPARE(result->status, CredentialResult::Status::Disabled);
    }

    void connectionShowsTheKdeText()
    {
        KdeConnection connection;
        connection.setInstanceUrl(instance);
        QTRY_COMPARE(connection.state(), Connection::WalletError);
        QCOMPARE(connection.errorString(), kdeDisabled);
    }

    void setupShowsTheKdeText()
    {
        KdeConnectionSetup setup;
        setup.setAccount(instance, QStringLiteral("token"), QString());
        setup.loadSecret();
        QTRY_VERIFY(!setup.isBusy());
        QCOMPARE(setup.walletError(), kdeDisabled);

        KdeConnectionSetup saving;
        saving.setAccount(instance, QStringLiteral("token"), QString());
        saving.editSecret(QStringLiteral("tok-kde"));
        saving.saveSecret();
        QTRY_VERIFY(!saving.isBusy());
        QCOMPARE(saving.walletError(), kdeDisabled);
    }

private:
    QTemporaryDir m_home;
};

QTEST_GUILESS_MAIN(KdeWalletDisabledTest)

#include "kdewalletdisabledtest.moc"
