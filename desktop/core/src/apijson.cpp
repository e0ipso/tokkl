#include "apijson.h"

#include <limits>

namespace Tokkl::Json
{

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

std::optional<qint64> positiveId(const QJsonValue &value)
{
    const std::optional<qint64> id = integer(value);
    if (!id || *id <= 0) {
        return std::nullopt;
    }
    return id;
}

// Missing and null both mean "none"; anything else must be a positive id.
bool nullableId(const QJsonValue &value, std::optional<qint64> &out)
{
    if (value.isUndefined() || value.isNull()) {
        out.reset();
        return true;
    }
    out = positiveId(value);
    return out.has_value();
}

bool optionalString(const QJsonValue &value, QString &out)
{
    if (value.isUndefined() || value.isNull()) {
        out.clear();
        return true;
    }
    if (!value.isString()) {
        return false;
    }
    out = value.toString();
    return true;
}

bool optionalBool(const QJsonValue &value, bool &out, bool fallback)
{
    if (value.isUndefined() || value.isNull()) {
        out = fallback;
        return true;
    }
    if (!value.isBool()) {
        return false;
    }
    out = value.toBool();
    return true;
}

std::optional<QDateTime> timestamp(const QJsonValue &value)
{
    if (!value.isString()) {
        return std::nullopt;
    }
    const QDateTime result = QDateTime::fromString(value.toString(), Qt::ISODateWithMs);
    if (!result.isValid()) {
        return std::nullopt;
    }
    return result;
}

// A whole number from min up, as an int.
std::optional<int> count(const QJsonValue &value, int min)
{
    const std::optional<qint64> number = integer(value);
    if (!number || *number < min || *number > std::numeric_limits<int>::max()) {
        return std::nullopt;
    }
    return int(*number);
}

QVariant idVariant(const std::optional<qint64> &id)
{
    return id ? QVariant(*id) : QVariant::fromValue(nullptr);
}

QJsonValue idJson(const std::optional<qint64> &id)
{
    return id ? QJsonValue(*id) : QJsonValue(QJsonValue::Null);
}

QString utcTimestamp(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODate);
}

}
