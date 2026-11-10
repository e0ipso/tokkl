// statuspresentation.json is shared with the GNOME extension's tests.

#include "statuspresentation.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

using namespace Tokkl;

namespace
{
TimerModel::Status statusOf(const QString &key)
{
    for (TimerModel::Status status : {TimerModel::Unconfigured,
                                      TimerModel::Loading,
                                      TimerModel::Ready,
                                      TimerModel::Busy,
                                      TimerModel::Stale,
                                      TimerModel::AuthenticationBlocked}) {
        if (timerStatusKey(status) == key) {
            return status;
        }
    }
    return TimerModel::Error;
}

QJsonObject fixture()
{
    QFile file(QStringLiteral(TOKKL_STATUS_FIXTURE));
    if (!file.open(QIODevice::ReadOnly)) {
        return QJsonObject();
    }
    return QJsonDocument::fromJson(file.readAll()).object();
}

QVariantMap expected(const QJsonObject &object)
{
    QVariantMap map = object.toVariantMap();
    map.insert(QStringLiteral("summary"), object.value(QStringLiteral("summary")).toVariant().toStringList());
    map.insert(QStringLiteral("menuLine"), object.value(QStringLiteral("menuLine")).toVariant().toStringList());
    return map;
}
}

class StatusPresentationTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void followsTheFixture_data()
    {
        QTest::addColumn<QJsonObject>("input");
        QTest::addColumn<QString>("policy");
        QTest::addColumn<QJsonObject>("presentation");

        QFile file(QStringLiteral(TOKKL_STATUS_FIXTURE));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QJsonArray cases = QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("cases")).toArray();
        QVERIFY(cases.size() > 100);
        int row = 0;
        for (const QJsonValue &value : cases) {
            const QJsonObject item = value.toObject();
            const QJsonObject input = item.value(QStringLiteral("input")).toObject();
            for (const QString &policy : {QStringLiteral("plasma"), QStringLiteral("macos"), QStringLiteral("gnome")}) {
                const QByteArray name = QByteArray::number(row) + ' ' + policy.toLatin1() + ' ' + QJsonDocument(input).toJson(QJsonDocument::Compact);
                QTest::newRow(name.constData()) << input << policy << item.value(policy).toObject();
            }
            ++row;
        }
    }

    void followsTheFixture()
    {
        QFETCH(QJsonObject, input);
        QFETCH(QString, policy);
        QFETCH(QJsonObject, presentation);

        StatusInput status;
        status.status = statusOf(input.value(QStringLiteral("status")).toString());
        status.hasDetail = input.value(QStringLiteral("hasDetail")).toBool();
        status.paused = input.value(QStringLiteral("paused")).toBool();
        status.showsSession = input.value(QStringLiteral("showsSession")).toBool();
        status.pomodoroMode = input.value(QStringLiteral("pomodoroMode")).toBool();
        status.hasMessage = input.value(QStringLiteral("hasMessage")).toBool();
        const StatusPolicy rules = policy == QLatin1String("plasma") ? StatusPolicy::plasma()
            : policy == QLatin1String("macos")                       ? StatusPolicy::macos()
                                                                     : StatusPolicy::gnome();
        QCOMPARE(StatusPresentation::of(status, rules).toVariantMap(), expected(presentation));
    }

    void elapsedFollowsTheFixture()
    {
        const QJsonArray cases = fixture().value(QStringLiteral("elapsed")).toArray();
        QVERIFY(cases.size() >= 5);
        for (const QJsonValue &value : cases) {
            const QJsonArray pair = value.toArray();
            QCOMPARE(TimerModel::formatElapsed(pair.at(0).toInteger()), pair.at(1).toString());
        }
    }

    void accessibleIsTheSummaryOutsideASession()
    {
        QFile file(QStringLiteral(TOKKL_STATUS_FIXTURE));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QJsonArray cases = QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("cases")).toArray();
        int checked = 0;
        for (const QJsonValue &value : cases) {
            const QJsonObject input = value.toObject().value(QStringLiteral("input")).toObject();
            if (input.value(QStringLiteral("showsSession")).toBool()) {
                continue;
            }
            StatusInput status;
            status.status = statusOf(input.value(QStringLiteral("status")).toString());
            status.hasDetail = input.value(QStringLiteral("hasDetail")).toBool();
            status.paused = input.value(QStringLiteral("paused")).toBool();
            status.pomodoroMode = input.value(QStringLiteral("pomodoroMode")).toBool();
            status.hasMessage = input.value(QStringLiteral("hasMessage")).toBool();
            for (const StatusPolicy &policy : {StatusPolicy::plasma(), StatusPolicy::macos(), StatusPolicy::gnome()}) {
                const StatusPresentation presentation = StatusPresentation::of(status, policy);
                QCOMPARE(presentation.accessible, presentation.summary);
                ++checked;
            }
        }
        QVERIFY(checked > 100);
    }

    // During a session the KDE panel's accessible name is the session's line.
    void accessibleNamesWhatTheSessionLineLeavesOut_data()
    {
        QTest::addColumn<QString>("status");
        QTest::addColumn<bool>("hasDetail");
        QTest::addColumn<bool>("hasMessage");
        QTest::addColumn<QStringList>("accessible");
        QTest::newRow("ready") << QStringLiteral("ready") << false << false << QStringList{QStringLiteral("project")};
        QTest::newRow("ready, message") << QStringLiteral("ready") << false << true << QStringList{QStringLiteral("project"), QStringLiteral("message")};
        QTest::newRow("busy") << QStringLiteral("busy") << false << false << QStringList{QStringLiteral("project"), QStringLiteral("connection")};
        QTest::newRow("stale, detail, message")
            << QStringLiteral("stale") << true << true
            << QStringList{QStringLiteral("project"), QStringLiteral("connection"), QStringLiteral("detail"), QStringLiteral("message")};
        QTest::newRow("unconfigured") << QStringLiteral("unconfigured") << true << false
                                      << QStringList{QStringLiteral("project"), QStringLiteral("connection"), QStringLiteral("detail")};
    }

    void accessibleNamesWhatTheSessionLineLeavesOut()
    {
        QFETCH(QString, status);
        QFETCH(bool, hasDetail);
        QFETCH(bool, hasMessage);
        QFETCH(QStringList, accessible);
        StatusInput input;
        input.status = statusOf(status);
        input.hasDetail = hasDetail;
        input.showsSession = true;
        input.pomodoroMode = true;
        input.hasMessage = hasMessage;
        const StatusPresentation presentation = StatusPresentation::of(input, StatusPolicy::plasma());
        QStringList keys;
        for (const StatusPart part : presentation.accessible) {
            keys.append(statusPartKey(part));
        }
        QCOMPARE(keys, accessible);
        QVERIFY(!presentation.accessible.contains(StatusPart::Session));
        QCOMPARE(presentation.summary.first(), StatusPart::Session);
    }

    void keysAreDistinct()
    {
        const QList<QStringList> lists{statusPartKeys(), statusMarkKeys(), timerStatusKeys(), primaryActionKeys()};
        const QList<qsizetype> sizes{7, 4, 7, 5};
        for (qsizetype i = 0; i < lists.size(); ++i) {
            const QStringList &keys = lists.at(i);
            QCOMPARE(QSet<QString>(keys.cbegin(), keys.cend()).size(), sizes.at(i));
            QVERIFY(!keys.contains(QString()));
        }
        QCOMPARE(StatusParts::partKeys(), statusPartKeys());
        QCOMPARE(StatusParts::statusKeys(), timerStatusKeys());
        QCOMPARE(StatusParts::actionKeys(), primaryActionKeys());
    }

    void fixtureCarriesTheKeys()
    {
        const QJsonObject keys = fixture().value(QStringLiteral("keys")).toObject();
        const auto list = [&keys](const char *name) {
            return keys.value(QLatin1String(name)).toVariant().toStringList();
        };
        QCOMPARE(list("parts"), statusPartKeys());
        QCOMPARE(list("marks"), statusMarkKeys());
        QCOMPARE(list("statuses"), timerStatusKeys());
        QCOMPARE(list("actions"), primaryActionKeys());
    }
};

QTEST_GUILESS_MAIN(StatusPresentationTest)

#include "statuspresentationtest.moc"
