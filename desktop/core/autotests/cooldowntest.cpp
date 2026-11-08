// Cooldown::waitMs on its own: the wait a Retry-After value asks for,
// clamped to the bounds, for every value a server can send.

#include "cooldown.h"

#include <QTest>

#include <limits>

using namespace Tokkl;

class CooldownTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void waitFollowsTheHeader_data()
    {
        QTest::addColumn<QByteArray>("header");
        QTest::addColumn<qint64>("expected");
        const QByteArray max = QByteArray::number(std::numeric_limits<qint64>::max());
        const QByteArray min = QByteArray::number(std::numeric_limits<qint64>::min());
        QTest::newRow("absent") << QByteArray() << qint64(Cooldown::defaultMs);
        QTest::newRow("seconds") << QByteArray(" 120 ") << qint64(120000);
        QTest::newRow("zero") << QByteArray("0") << Cooldown::minMs;
        QTest::newRow("negative") << QByteArray("-5") << Cooldown::minMs;
        QTest::newRow("just over an hour") << QByteArray("3601") << Cooldown::maxMs;
        QTest::newRow("overflows when multiplied") << QByteArray("9223372036854776") << Cooldown::maxMs;
        QTest::newRow("largest qint64") << max << Cooldown::maxMs;
        QTest::newRow("smallest qint64") << min << Cooldown::minMs;
        QTest::newRow("beyond qint64") << QByteArray("99999999999999999999") << qint64(Cooldown::defaultMs);
        QTest::newRow("garbage") << QByteArray("soon") << qint64(Cooldown::defaultMs);
        QTest::newRow("date long past") << QByteArray("Mon, 01 Jan 1990 00:00:00 +0000") << Cooldown::minMs;
        QTest::newRow("date far ahead") << QByteArray("Fri, 01 Jan 9999 00:00:00 +0000") << Cooldown::maxMs;
    }

    void waitFollowsTheHeader()
    {
        QFETCH(QByteArray, header);
        QFETCH(qint64, expected);
        QCOMPARE(Cooldown::waitMs(header), expected);
    }
};

QTEST_GUILESS_MAIN(CooldownTest)

#include "cooldowntest.moc"
