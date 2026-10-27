// The Pomodoro cycle and span snapping against the fixtures in
// packages/common, the cases the web app and the other clients run. Each case
// is a data row named after it.

#include "pomodorocycle.h"
#include "snap.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

#include <algorithm>
#include <limits>
#include <utility>

using namespace Tokkl;

namespace
{
// The config values a case can set, by their names in the fixtures.
const std::pair<QLatin1String, int PomodoroConfig::*> configFields[] = {
    {QLatin1String("workMinutes"), &PomodoroConfig::workMinutes},
    {QLatin1String("shortRestMinutes"), &PomodoroConfig::shortRestMinutes},
    {QLatin1String("longRestMinutes"), &PomodoroConfig::longRestMinutes},
    {QLatin1String("longRestEvery"), &PomodoroConfig::longRestEvery},
};

void readCases(const QString &file, QJsonArray &cases)
{
    QFile f(QStringLiteral(TOKKL_COMMON_FIXTURES_DIR "/") + file);
    QVERIFY2(f.open(QIODevice::ReadOnly), qPrintable(f.fileName() + QStringLiteral(": ") + f.errorString()));
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(f.readAll(), &error);
    QVERIFY2(document.isArray(), qPrintable(f.fileName() + QStringLiteral(": ") + error.errorString()));
    cases = document.array();
    QVERIFY(!cases.isEmpty());
}

void addRows(const QJsonArray &cases)
{
    QTest::addColumn<QJsonObject>("testCase");
    for (const QJsonValue &value : cases) {
        const QJsonObject testCase = value.toObject();
        QTest::newRow(testCase.value(QLatin1String("name")).toString().toUtf8().constData()) << testCase;
    }
}

// Text that does not parse gives an invalid QDateTime, which the functions
// must refuse.
QDateTime instant(const QJsonValue &value)
{
    return QDateTime::fromString(value.toString(), Qt::ISODateWithMs);
}

// Counts, lengths and resolutions are int in C++, so a fraction or another
// type cannot be passed at all. toInteger() gives the qint64 minimum for both.
std::optional<int> wholeNumber(const QJsonValue &value)
{
    const qint64 number = value.toInteger(std::numeric_limits<qint64>::min());
    if (number < std::numeric_limits<int>::min() || number > std::numeric_limits<int>::max()) {
        return std::nullopt;
    }
    return int(number);
}

// nullopt when the phase cannot be passed: an unknown kind or a count that is
// not a whole number.
std::optional<SessionPhase> phaseArgument(const QJsonValue &value)
{
    const QJsonObject object = value.toObject();
    const std::optional<PhaseKind> kind = parsePhaseKind(object.value(QLatin1String("kind")).toString());
    const std::optional<int> completed = wholeNumber(object.value(QLatin1String("completed")));
    if (!kind || !completed) {
        return std::nullopt;
    }
    return SessionPhase{*kind, instant(object.value(QLatin1String("startedAt"))), *completed};
}

// The defaults for the values options leaves out. nullopt when a value cannot
// be passed.
std::optional<PomodoroConfig> configArgument(const QJsonObject &options)
{
    PomodoroConfig config;
    for (const auto &[name, field] : configFields) {
        if (!options.contains(name)) {
            continue;
        }
        const std::optional<int> value = wholeNumber(options.value(name));
        if (!value) {
            return std::nullopt;
        }
        config.*field = *value;
    }
    return config;
}

// An error result where the case expects {"throws": "RangeError"}, otherwise
// a value that compare checks against expected.
template<typename T, typename Compare>
void checkResult(const std::optional<T> &actual, const QJsonValue &expected, Compare compare)
{
    if (expected.toObject().contains(QLatin1String("throws"))) {
        QCOMPARE(expected.toObject().value(QLatin1String("throws")).toString(), QStringLiteral("RangeError"));
        QVERIFY2(!actual, "expected an error, got a value");
        return;
    }
    QVERIFY2(actual, "expected a value, got an error");
    compare(*actual, expected);
}

void compareInstant(const QDateTime &actual, const QJsonValue &expected)
{
    QCOMPARE(actual, instant(expected));
}

void compareSeconds(double actual, const QJsonValue &expected)
{
    QVERIFY(expected.isDouble());
    QCOMPARE_EQ(actual, expected.toDouble());
}

void compareTransition(TransitionKind actual, const QJsonValue &expected)
{
    QCOMPARE(transitionKindName(actual), expected.toString());
    QVERIFY(parseTransitionKind(expected.toString()) == actual);
}

void comparePhase(const SessionPhase &actual, const QJsonValue &expected)
{
    const QJsonObject object = expected.toObject();
    QCOMPARE(phaseKindName(actual.kind), object.value(QLatin1String("kind")).toString());
    QCOMPARE(actual.startedAt, instant(object.value(QLatin1String("startedAt"))));
    QCOMPARE(actual.completed, object.value(QLatin1String("completed")).toInt(-1));
}

void compareChange(const PhaseChange &actual, const QJsonValue &expected)
{
    const QJsonObject object = expected.toObject();
    comparePhase(actual.next, object.value(QLatin1String("next")));
    compareTransition(actual.transition, object.value(QLatin1String("transition")));
    QCOMPARE(actual.skipped, object.value(QLatin1String("skipped")).toBool());
}

// null is a span too short to keep.
void compareSpan(const std::optional<SnappedSpan> &actual, const QJsonValue &expected)
{
    if (expected.isNull()) {
        QVERIFY2(!actual, "expected no span, got one");
        return;
    }
    QVERIFY2(actual, "expected a span, got none");
    const QJsonObject object = expected.toObject();
    QCOMPARE(actual->start, instant(object.value(QLatin1String("start"))));
    QCOMPARE(actual->stop, instant(object.value(QLatin1String("stop"))));
}
}

class PomodoroCycleTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        readCases(QStringLiteral("pomodoroSession.json"), m_sessionCases);
        readCases(QStringLiteral("snap.json"), m_snapCases);
    }

    void pomodoroSession_data()
    {
        addRows(m_sessionCases);
    }

    void pomodoroSession()
    {
        QFETCH(QJsonObject, testCase);
        ++m_sessionRows;
        const QJsonObject input = testCase.value(QLatin1String("input")).toObject();
        const QJsonValue expected = testCase.value(QLatin1String("expected"));
        const QJsonObject options = testCase.value(QLatin1String("options")).toObject();
        for (const QString &key : options.keys()) {
            const bool known = std::any_of(std::begin(configFields), std::end(configFields), [&key](const auto &field) {
                return field.first == key;
            });
            QVERIFY2(known, qPrintable(QStringLiteral("Unknown option: ") + key));
        }

        const QString function = input.value(QLatin1String("function")).toString();
        const std::optional<SessionPhase> phase = phaseArgument(input.value(QLatin1String("phase")));
        const std::optional<PomodoroConfig> config = configArgument(options);
        const bool callable = phase && config;
        const QDateTime at = instant(input.value(QLatin1String("at")));
        if (function == QLatin1String("startSession")) {
            checkResult(startSession(at), expected, comparePhase);
        } else if (function == QLatin1String("plannedEnd")) {
            checkResult(callable ? plannedEnd(*phase, *config) : std::nullopt, expected, compareInstant);
        } else if (function == QLatin1String("overtimeSeconds")) {
            checkResult(callable ? overtimeSeconds(*phase, at, *config) : std::nullopt, expected, compareSeconds);
        } else if (function == QLatin1String("transitionKind")) {
            checkResult(callable ? transitionKind(*phase, *config) : std::nullopt, expected, compareTransition);
        } else if (function == QLatin1String("nextPhase")) {
            checkResult(callable ? nextPhase(*phase, at, *config) : std::nullopt, expected, compareChange);
        } else if (function == QLatin1String("pomodoroEntrySpan")) {
            const std::optional<int> minutes = wholeNumber(input.value(QLatin1String("minutes")));
            checkResult(minutes ? pomodoroEntrySpan(instant(input.value(QLatin1String("start"))), instant(input.value(QLatin1String("end"))), *minutes,
                                                    input.value(QLatin1String("timeZone")).toString())
                                : std::nullopt,
                        expected,
                        compareSpan);
        } else {
            QFAIL(qPrintable(QStringLiteral("Unknown function: ") + function));
        }
    }

    void snap_data()
    {
        addRows(m_snapCases);
    }

    void snap()
    {
        QFETCH(QJsonObject, testCase);
        ++m_snapRows;
        const QJsonObject input = testCase.value(QLatin1String("input")).toObject();
        const std::optional<int> minutes = wholeNumber(input.value(QLatin1String("minutes")));
        checkResult(minutes ? snapSpan(instant(input.value(QLatin1String("start"))), instant(input.value(QLatin1String("stop"))), *minutes,
                                       input.value(QLatin1String("timeZone")).toString())
                            : std::nullopt,
                    testCase.value(QLatin1String("expected")),
                    compareSpan);
    }

    // Counts the rows the functions above ran, so a case they skip fails
    // here. It needs the whole test run, not this function alone.
    void everyCaseRan()
    {
        QCOMPARE(m_sessionRows, m_sessionCases.size());
        QCOMPARE(m_snapRows, m_snapCases.size());
    }

private:
    QJsonArray m_sessionCases;
    QJsonArray m_snapCases;
    qsizetype m_sessionRows = 0;
    qsizetype m_snapRows = 0;
};

QTEST_GUILESS_MAIN(PomodoroCycleTest)

#include "pomodorocycletest.moc"
