#pragma once

#include <QDateTime>
#include <QJsonObject>
#include <QJsonValue>
#include <QLatin1String>
#include <QString>
#include <QVariant>

#include <optional>

// The JSON field readers and writers the API decoders and encoders share.
// Each reader returns nullopt or false for a value of the wrong shape.
namespace Tokkl::Json
{

// A number with no fraction part that fits a qint64.
std::optional<qint64> integer(const QJsonValue &value);
// A whole number above 0.
std::optional<qint64> positiveId(const QJsonValue &value);
// Missing and null both mean none; anything else must be a positive id.
bool nullableId(const QJsonValue &value, std::optional<qint64> &out);
// A string, or null or missing for empty; false for anything else.
bool optionalString(const QJsonValue &value, QString &out);
// A bool, or fallback when null or missing; false for anything else.
bool optionalBool(const QJsonValue &value, bool &out, bool fallback);
// A date and time as Qt::ISODateWithMs reads it.
std::optional<QDateTime> timestamp(const QJsonValue &value);
// A whole number from min up, as an int.
std::optional<int> count(const QJsonValue &value, int min);

// A key that must be present: false when it is missing. A null value leaves
// out empty; anything else must decode.
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

// An id for QML: the number, or null for none.
QVariant idVariant(const std::optional<qint64> &id);
// An id for a request body: the number, or null for none.
QJsonValue idJson(const std::optional<qint64> &id);
// The time in UTC, as Qt::ISODate writes it.
QString utcTimestamp(const QDateTime &time);

}
