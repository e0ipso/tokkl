#pragma once

#include <QDateTime>
#include <QJsonObject>
#include <QJsonValue>
#include <QLatin1String>
#include <QString>
#include <QVariant>

#include <optional>

// Readers return nullopt or false for a value of the wrong shape.
namespace Tokkl::Json
{

// No fraction part, and fits a qint64.
std::optional<qint64> integer(const QJsonValue &value);
std::optional<qint64> positiveId(const QJsonValue &value);
// Missing and null both mean none; anything else must be a positive id.
bool nullableId(const QJsonValue &value, std::optional<qint64> &out);
// null or missing reads as empty.
bool optionalString(const QJsonValue &value, QString &out);
// null or missing reads as fallback.
bool optionalBool(const QJsonValue &value, bool &out, bool fallback);
std::optional<QDateTime> timestamp(const QJsonValue &value);
std::optional<int> count(const QJsonValue &value, int min);

// The key must be present; null leaves out empty.
template<typename T>
bool nullable(const QJsonObject &object, QLatin1String key, std::optional<T> (*decode)(const QJsonValue &), std::optional<T> &out)
{
    const QJsonValue value = object.value(key);
    if (value.isUndefined()) {
        return false;
    }
    if (value.isNull()) {
        out.reset();
        return true;
    }
    out = decode(value);
    return out.has_value();
}

QVariant idVariant(const std::optional<qint64> &id);
QJsonValue idJson(const std::optional<qint64> &id);
QString utcTimestamp(const QDateTime &time);

}
