#include "pomodororecord.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>

#include <limits>
#include <utility>

namespace Tokkl
{

namespace
{
constexpr int version = 1;
constexpr qint64 noInteger = std::numeric_limits<qint64>::min();

std::optional<qint64> integer(const QJsonValue &value)
{
    if (!value.isDouble()) {
        return std::nullopt;
    }
    const qint64 result = value.toInteger(noInteger);
    if (result == noInteger) {
        return std::nullopt;
    }
    return result;
}

std::optional<int> count(const QJsonValue &value)
{
    const std::optional<qint64> number = integer(value);
    if (!number || *number < 0 || *number > std::numeric_limits<int>::max()) {
        return std::nullopt;
    }
    return int(*number);
}

std::optional<QDateTime> instant(const QJsonValue &value)
{
    const std::optional<qint64> ms = integer(value);
    if (!ms) {
        return std::nullopt;
    }
    const QDateTime result = QDateTime::fromMSecsSinceEpoch(*ms, QTimeZone::UTC);
    if (!result.isValid()) {
        return std::nullopt;
    }
    return result;
}

QJsonValue instantJson(const QDateTime &time)
{
    return QJsonValue(time.toMSecsSinceEpoch());
}

// Missing and null both mean none; anything else must be a positive id.
bool nullableId(const QJsonValue &value, std::optional<qint64> &out)
{
    if (value.isUndefined() || value.isNull()) {
        out.reset();
        return true;
    }
    const std::optional<qint64> id = integer(value);
    if (!id || *id <= 0) {
        return false;
    }
    out = id;
    return true;
}

QJsonValue idJson(const std::optional<qint64> &id)
{
    return id ? QJsonValue(*id) : QJsonValue(QJsonValue::Null);
}

bool flag(const QJsonValue &value, bool &out)
{
    if (!value.isBool()) {
        return false;
    }
    out = value.toBool();
    return true;
}

QString stringOf(const QJsonValue &value)
{
    return value.isString() ? value.toString() : QString();
}

QJsonObject configJson(const PomodoroConfig &config)
{
    return QJsonObject{
        {QStringLiteral("workMinutes"), config.workMinutes},
        {QStringLiteral("shortRestMinutes"), config.shortRestMinutes},
        {QStringLiteral("longRestMinutes"), config.longRestMinutes},
        {QStringLiteral("longRestEvery"), config.longRestEvery},
    };
}

// A config whose every value is inside its range.
std::optional<PomodoroConfig> readConfig(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    PomodoroConfig config;
    const std::pair<QLatin1String, int PomodoroConfig::*> fields[] = {
        {QLatin1String("workMinutes"), &PomodoroConfig::workMinutes},
        {QLatin1String("shortRestMinutes"), &PomodoroConfig::shortRestMinutes},
        {QLatin1String("longRestMinutes"), &PomodoroConfig::longRestMinutes},
        {QLatin1String("longRestEvery"), &PomodoroConfig::longRestEvery},
    };
    for (const auto &[key, field] : fields) {
        const std::optional<int> minutes = count(object.value(key));
        if (!minutes) {
            return std::nullopt;
        }
        config.*field = *minutes;
    }
    if (!config.isValid()) {
        return std::nullopt;
    }
    return config;
}

QJsonObject sessionJson(const PomodoroSessionRecord &session)
{
    return QJsonObject{
        {QStringLiteral("id"), session.id},
        {QStringLiteral("revision"), session.revision},
        {QStringLiteral("config"), configJson(session.config)},
        {QStringLiteral("projectId"), idJson(session.projectId)},
        {QStringLiteral("billable"), session.billable},
        {QStringLiteral("phase"),
         QJsonObject{
             {QStringLiteral("kind"), phaseKindName(session.phase.kind)},
             {QStringLiteral("startedAt"), instantJson(session.phase.startedAt)},
             {QStringLiteral("completed"), session.phase.completed},
         }},
        {QStringLiteral("pomodoroStart"), instantJson(session.pomodoroStart)},
        {QStringLiteral("ending"), session.ending},
    };
}

std::optional<PomodoroSessionRecord> readSession(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    PomodoroSessionRecord session;
    session.id = stringOf(object.value(QLatin1String("id")));
    const std::optional<qint64> revision = integer(object.value(QLatin1String("revision")));
    const std::optional<PomodoroConfig> config = readConfig(object.value(QLatin1String("config")));
    const QJsonObject phase = object.value(QLatin1String("phase")).toObject();
    const std::optional<PhaseKind> kind = parsePhaseKind(phase.value(QLatin1String("kind")).toString());
    const std::optional<QDateTime> startedAt = instant(phase.value(QLatin1String("startedAt")));
    const std::optional<int> completed = count(phase.value(QLatin1String("completed")));
    const std::optional<QDateTime> pomodoroStart = instant(object.value(QLatin1String("pomodoroStart")));
    if (session.id.isEmpty() || !revision || *revision < 0 || !config || !kind || !startedAt || !completed || !pomodoroStart
        || !nullableId(object.value(QLatin1String("projectId")), session.projectId) || !flag(object.value(QLatin1String("billable")), session.billable)
        || !flag(object.value(QLatin1String("ending")), session.ending)) {
        return std::nullopt;
    }
    session.revision = *revision;
    session.config = *config;
    session.phase = SessionPhase{*kind, *startedAt, *completed};
    session.pomodoroStart = *pomodoroStart;
    // The open pomodoro starts with its work phase, so never after the
    // phase that runs now.
    if (session.pomodoroStart > session.phase.startedAt || (session.phase.kind == PhaseKind::Work && session.pomodoroStart != session.phase.startedAt)) {
        return std::nullopt;
    }
    // The cycle accepts the phase under the session's lengths.
    if (!plannedEnd(session.phase, session.config) || !transitionKind(session.phase, session.config)) {
        return std::nullopt;
    }
    return session;
}

QJsonObject unsavedJson(const UnsavedPomodoro &item)
{
    return QJsonObject{
        {QStringLiteral("id"), item.id},
        {QStringLiteral("owner"), item.owner},
        {QStringLiteral("workspaceId"), item.workspaceId},
        {QStringLiteral("start"), instantJson(item.start)},
        {QStringLiteral("stop"), instantJson(item.stop)},
        {QStringLiteral("duration"), item.duration},
        {QStringLiteral("projectId"), idJson(item.projectId)},
        {QStringLiteral("billable"), item.billable},
        {QStringLiteral("attempts"), item.attempts},
        {QStringLiteral("retryAt"), instantJson(item.retryAt)},
    };
}

std::optional<UnsavedPomodoro> readUnsaved(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    UnsavedPomodoro item;
    item.id = stringOf(object.value(QLatin1String("id")));
    item.owner = stringOf(object.value(QLatin1String("owner")));
    const std::optional<qint64> workspace = integer(object.value(QLatin1String("workspaceId")));
    const std::optional<QDateTime> start = instant(object.value(QLatin1String("start")));
    const std::optional<QDateTime> stop = instant(object.value(QLatin1String("stop")));
    const std::optional<qint64> duration = integer(object.value(QLatin1String("duration")));
    const std::optional<int> attempts = count(object.value(QLatin1String("attempts")));
    const std::optional<QDateTime> retryAt = instant(object.value(QLatin1String("retryAt")));
    if (item.id.isEmpty() || item.owner.isEmpty() || !workspace || *workspace <= 0 || !start || !stop || !duration || !attempts || !retryAt
        || retryAt->toMSecsSinceEpoch() < 0 || !nullableId(object.value(QLatin1String("projectId")), item.projectId)
        || !flag(object.value(QLatin1String("billable")), item.billable)) {
        return std::nullopt;
    }
    // A stopped entry of whole seconds.
    const qint64 ms = start->msecsTo(*stop);
    if (ms <= 0 || ms % 1000 != 0 || ms / 1000 != *duration) {
        return std::nullopt;
    }
    item.workspaceId = *workspace;
    item.start = *start;
    item.stop = *stop;
    item.duration = *duration;
    item.attempts = *attempts;
    item.retryAt = *retryAt;
    return item;
}
}

QByteArray PomodoroRecord::toJson() const
{
    if (isEmpty()) {
        return QByteArray();
    }
    QJsonArray queue;
    for (const UnsavedPomodoro &item : unsaved) {
        queue.append(unsavedJson(item));
    }
    QJsonObject object{
        {QStringLiteral("version"), version},
        {QStringLiteral("config"), config ? QJsonValue(configJson(*config)) : QJsonValue(QJsonValue::Null)},
        {QStringLiteral("session"), session ? QJsonValue(sessionJson(*session)) : QJsonValue(QJsonValue::Null)},
        {QStringLiteral("unsaved"), queue},
    };
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

PomodoroRecord PomodoroRecord::fromJson(const QByteArray &json)
{
    const QJsonObject object = QJsonDocument::fromJson(json).object();
    if (integer(object.value(QLatin1String("version"))) != version) {
        return PomodoroRecord();
    }
    PomodoroRecord record;
    record.config = readConfig(object.value(QLatin1String("config")));
    record.session = readSession(object.value(QLatin1String("session")));
    QSet<QString> ids;
    for (const QJsonValue &value : object.value(QLatin1String("unsaved")).toArray()) {
        std::optional<UnsavedPomodoro> item = readUnsaved(value);
        if (!item || ids.contains(item->id)) {
            continue;
        }
        ids.insert(item->id);
        record.unsaved.append(std::move(*item));
    }
    return record;
}

}
