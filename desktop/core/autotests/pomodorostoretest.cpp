// The Pomodoro store on a QSettings file, and the checks PomodoroRecord runs
// on the text it reads back.

#include "pomodororecord.h"
#include "pomodorostore.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QTemporaryDir>
#include <QTest>

#include <initializer_list>
#include <utility>

using namespace Tokkl;

namespace
{
const QString ownerA = QStringLiteral("https://a.example.test/ 3 7");
const QString ownerB = QStringLiteral("https://b.example.test/tokkl/ 3 7");

QDateTime at(const char *text)
{
    return QDateTime::fromString(QLatin1String(text), Qt::ISODateWithMs);
}

// A session in its first short rest, with two ended pomodoros waiting.
PomodoroRecord sampleRecord()
{
    PomodoroRecord record;
    record.config = PomodoroConfig{50, 10, 20, 3};

    PomodoroSessionRecord session;
    session.id = QStringLiteral("session-1");
    session.revision = 2;
    session.projectId = 11;
    session.billable = true;
    session.phase = SessionPhase{PhaseKind::ShortRest, at("2026-10-16T09:25:30.250Z"), 1};
    session.pomodoroStart = at("2026-10-16T09:00:00.125Z");
    record.session = session;

    UnsavedPomodoro first;
    first.id = QStringLiteral("pomodoro-1");
    first.owner = ownerA;
    first.workspaceId = 7;
    first.start = at("2026-10-16T08:00:00.000Z");
    first.stop = at("2026-10-16T08:30:00.000Z");
    first.duration = 1800;
    first.projectId = 11;
    first.billable = true;
    first.attempts = 2;
    first.retryAt = at("2026-10-16T09:10:00.500Z");
    UnsavedPomodoro second = first;
    second.id = QStringLiteral("pomodoro-2");
    second.start = first.stop;
    second.stop = at("2026-10-16T09:00:00.000Z");
    second.projectId.reset();
    second.billable = false;
    second.attempts = 0;
    second.retryAt = QDateTime::fromMSecsSinceEpoch(0, QTimeZone::UTC);
    record.unsaved = {first, second};
    return record;
}

QJsonObject jsonObject(const QByteArray &json)
{
    return QJsonDocument::fromJson(json).object();
}

QByteArray jsonText(const QJsonObject &object)
{
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

// Sets the member at path, keys joined by dots, in object. An undefined
// value removes it.
void setPath(QJsonObject &object, const QString &path, const QJsonValue &value)
{
    const qsizetype dot = path.indexOf(QLatin1Char('.'));
    if (dot < 0) {
        object.insert(path, value);
        return;
    }
    const QString key = path.left(dot);
    QJsonObject child = object.value(key).toObject();
    setPath(child, path.mid(dot + 1), value);
    object.insert(key, child);
}

// object with the members at the given paths set.
QJsonValue changed(QJsonObject object, std::initializer_list<std::pair<QString, QJsonValue>> changes)
{
    for (const auto &[path, value] : changes) {
        setPath(object, path, value);
    }
    return object;
}

qint64 ms(const char *text)
{
    return at(text).toMSecsSinceEpoch();
}
}

class PomodoroStoreTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void keepsModeAndRecordsPerOwner()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString path = dir.filePath(QStringLiteral("pomodoro.ini"));
        QSettings settings(path, QSettings::IniFormat);
        SettingsPomodoroStore store(&settings);
        QVERIFY(!store.loadPomodoroMode());
        QVERIFY(store.loadRecord(ownerA).isEmpty());

        const PomodoroRecord record = sampleRecord();
        PomodoroRecord other;
        other.config = PomodoroConfig{30, 5, 15, 4};
        QVERIFY(store.savePomodoroMode(true));
        QVERIFY(store.saveRecord(ownerA, record.toJson()));
        QVERIFY(store.saveRecord(ownerB, other.toJson()));
        {
            // What a save reported as stored is on disk.
            QSettings reopened(path, QSettings::IniFormat);
            SettingsPomodoroStore stored(&reopened);
            QVERIFY(stored.loadPomodoroMode());
            QCOMPARE(PomodoroRecord::fromJson(stored.loadRecord(ownerA)), record);
            QCOMPARE(PomodoroRecord::fromJson(stored.loadRecord(ownerB)), other);
        }
        const QJsonObject json = jsonObject(record.toJson());
        QCOMPARE(json.value(QLatin1String("version")).toInteger(), 1);
        QCOMPARE(json.value(QLatin1String("session")).toObject().value(QLatin1String("pomodoroStart")).toInteger(), ms("2026-10-16T09:00:00.125Z"));

        // A record that is not JSON, or of a later version, holds nothing.
        QVERIFY(store.saveRecord(ownerB, QByteArrayLiteral("{\"version\":1,")));
        QVERIFY(PomodoroRecord::fromJson(store.loadRecord(ownerB)).isEmpty());
        QJsonObject later = json;
        later.insert(QLatin1String("version"), 2);
        QVERIFY(store.saveRecord(ownerB, jsonText(later)));
        QVERIFY(PomodoroRecord::fromJson(store.loadRecord(ownerB)).isEmpty());

        // A broken queue item is skipped; the item next to it stays.
        QJsonObject damaged = json;
        QJsonArray queue = damaged.value(QLatin1String("unsaved")).toArray();
        QJsonObject item = queue.at(0).toObject();
        item.insert(QLatin1String("stop"), item.value(QLatin1String("start")));
        queue.replace(0, item);
        damaged.insert(QLatin1String("unsaved"), queue);
        QVERIFY(store.saveRecord(ownerA, jsonText(damaged)));
        const PomodoroRecord read = PomodoroRecord::fromJson(store.loadRecord(ownerA));
        QCOMPARE(read.unsaved, QList<UnsavedPomodoro>{record.unsaved.at(1)});
        QCOMPARE(read.session, record.session);
        QCOMPARE(read.config, record.config);

        // An empty record removes the owner's record only.
        QVERIFY(PomodoroRecord().toJson().isEmpty());
        QVERIFY(store.saveRecord(ownerB, PomodoroRecord().toJson()));
        QVERIFY(store.loadRecord(ownerB).isEmpty());
        QVERIFY(!store.loadRecord(ownerA).isEmpty());
        QVERIFY(store.savePomodoroMode(false));
        QVERIFY(!store.loadPomodoroMode());

        // A file that cannot be written fails the save.
        QFile blocker(dir.filePath(QStringLiteral("blocker")));
        QVERIFY(blocker.open(QIODevice::WriteOnly));
        blocker.close();
        QSettings unwritable(dir.filePath(QStringLiteral("blocker/pomodoro.ini")), QSettings::IniFormat);
        SettingsPomodoroStore failing(&unwritable);
        QVERIFY(!failing.savePomodoroMode(true));
        QVERIFY(!failing.saveRecord(ownerA, record.toJson()));
    }

    void brokenSessionIsNone_data()
    {
        const QJsonObject session = jsonObject(sampleRecord().toJson()).value(QLatin1String("session")).toObject();
        QTest::addColumn<QJsonValue>("broken");
        QTest::newRow("not an object") << QJsonValue(QStringLiteral("session-1"));
        QTest::newRow("empty id") << changed(session, {{QStringLiteral("id"), QString()}});
        QTest::newRow("negative revision") << changed(session, {{QStringLiteral("revision"), -1}});
        QTest::newRow("ending not a flag") << changed(session, {{QStringLiteral("ending"), QStringLiteral("no")}});
        QTest::newRow("config out of range") << changed(session, {{QStringLiteral("config.workMinutes"), 181}});
        QTest::newRow("unknown phase") << changed(session, {{QStringLiteral("phase.kind"), QStringLiteral("nap")}});
        QTest::newRow("negative count") << changed(session, {{QStringLiteral("phase.completed"), -1}});
        QTest::newRow("phase start as text") << changed(session, {{QStringLiteral("phase.startedAt"), QStringLiteral("2026-10-16T09:25:30.250Z")}});
        QTest::newRow("pomodoro starts after its phase") << changed(session, {{QStringLiteral("pomodoroStart"), ms("2026-10-16T09:25:30.251Z")}});
        QTest::newRow("work phase after its pomodoro start") << changed(session, {{QStringLiteral("phase.kind"), QStringLiteral("work")}});
        QTest::newRow("project id 0") << changed(session, {{QStringLiteral("projectId"), 0}});
        QTest::newRow("billable missing") << changed(session, {{QStringLiteral("billable"), QJsonValue(QJsonValue::Undefined)}});
    }

    void brokenSessionIsNone()
    {
        QFETCH(QJsonValue, broken);
        const PomodoroRecord record = sampleRecord();
        QJsonObject json = jsonObject(record.toJson());
        json.insert(QLatin1String("session"), broken);

        const PomodoroRecord read = PomodoroRecord::fromJson(jsonText(json));
        QVERIFY(!read.session.has_value());
        QCOMPARE(read.unsaved, record.unsaved);
        QCOMPARE(read.config, record.config);
    }

    void brokenQueueItemIsSkipped_data()
    {
        // A copy of the first item under a new id, so only the change breaks it.
        QJsonObject item = jsonObject(sampleRecord().toJson()).value(QLatin1String("unsaved")).toArray().at(0).toObject();
        item.insert(QLatin1String("id"), QStringLiteral("pomodoro-3"));
        const qint64 start = item.value(QLatin1String("start")).toInteger();
        QTest::addColumn<QJsonValue>("broken");
        QTest::newRow("not an object") << QJsonValue(5);
        QTest::newRow("empty id") << changed(item, {{QStringLiteral("id"), QString()}});
        QTest::newRow("repeated id") << changed(item, {{QStringLiteral("id"), QStringLiteral("pomodoro-1")}});
        QTest::newRow("no owner") << changed(item, {{QStringLiteral("owner"), QString()}});
        QTest::newRow("no workspace") << changed(item, {{QStringLiteral("workspaceId"), 0}});
        QTest::newRow("negative attempts") << changed(item, {{QStringLiteral("attempts"), -1}});
        QTest::newRow("negative retry time") << changed(item, {{QStringLiteral("retryAt"), -1}});
        QTest::newRow("stop at start") << changed(item, {{QStringLiteral("stop"), start}, {QStringLiteral("duration"), 0}});
        QTest::newRow("duration off by a second") << changed(item, {{QStringLiteral("duration"), 1799}});
        QTest::newRow("fractional duration") << changed(item, {{QStringLiteral("duration"), 1800.5}});
        QTest::newRow("project id 0") << changed(item, {{QStringLiteral("projectId"), 0}});
    }

    void brokenQueueItemIsSkipped()
    {
        QFETCH(QJsonValue, broken);
        const PomodoroRecord record = sampleRecord();
        QJsonObject json = jsonObject(record.toJson());
        QJsonArray queue = json.value(QLatin1String("unsaved")).toArray();
        queue.insert(1, broken);
        json.insert(QLatin1String("unsaved"), queue);

        const PomodoroRecord read = PomodoroRecord::fromJson(jsonText(json));
        QCOMPARE(read.unsaved, record.unsaved);
        QCOMPARE(read.session, record.session);
    }
};

QTEST_GUILESS_MAIN(PomodoroStoreTest)
#include "pomodorostoretest.moc"
