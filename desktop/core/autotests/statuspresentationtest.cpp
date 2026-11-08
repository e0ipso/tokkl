// StatusPresentation::of() against the shared fixture,
// statuspresentation.json, which the GNOME extension's tests read too: for
// every input, the parts each panel's words show, in order, and the mark of
// its short text.

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
    static const QHash<QString, TimerModel::Status> statuses{
        {QStringLiteral("unconfigured"), TimerModel::Unconfigured},
        {QStringLiteral("loading"), TimerModel::Loading},
        {QStringLiteral("ready"), TimerModel::Ready},
        {QStringLiteral("busy"), TimerModel::Busy},
        {QStringLiteral("stale"), TimerModel::Stale},
        {QStringLiteral("authentication-blocked"), TimerModel::AuthenticationBlocked},
        {QStringLiteral("error"), TimerModel::Error},
    };
    return statuses.value(key, TimerModel::Error);
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

    // Every part and mark has a key, and the keys differ.
    void keysAreDistinct()
    {
        QSet<QString> parts;
        for (const StatusPart part : {StatusPart::Activity,
                                      StatusPart::Session,
                                      StatusPart::Project,
                                      StatusPart::Connection,
                                      StatusPart::Detail,
                                      StatusPart::PomodoroMode,
                                      StatusPart::Message}) {
            parts.insert(statusPartKey(part));
        }
        QCOMPARE(parts.size(), 7);
        QVERIFY(!parts.contains(QString()));
        QSet<QString> marks;
        for (const StatusMark mark : {StatusMark::None, StatusMark::Pending, StatusMark::Alert, StatusMark::Unconfigured}) {
            marks.insert(statusMarkKey(mark));
        }
        QCOMPARE(marks.size(), 4);
        QVERIFY(!marks.contains(QString()));
    }
};

QTEST_GUILESS_MAIN(StatusPresentationTest)

#include "statuspresentationtest.moc"
