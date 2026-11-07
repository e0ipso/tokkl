#include "apitypes.h"

#include "apijson.h"

#include <QJsonDocument>

namespace Tokkl
{

using namespace Json;

namespace
{
// The preferences that hold the Pomodoro lengths: the config value each one
// fills, the range the server accepts and the change that sets it.
struct PomodoroPreference {
    PomodoroField field;
    QLatin1String key;
    int PomodoroConfig::*value;
    PomodoroRange range;
    std::optional<int> PomodoroConfigUpdate::*change;
};

const PomodoroPreference pomodoroPreferences[] = {
    {PomodoroField::WorkMinutes,
     QLatin1String("pomodoro_focus_interval_in_minutes"),
     &PomodoroConfig::workMinutes,
     PomodoroConfig::workMinutesRange,
     &PomodoroConfigUpdate::workMinutes},
    {PomodoroField::ShortRestMinutes,
     QLatin1String("pomodoro_break_interval_in_minutes"),
     &PomodoroConfig::shortRestMinutes,
     PomodoroConfig::shortRestMinutesRange,
     &PomodoroConfigUpdate::shortRestMinutes},
    {PomodoroField::LongRestMinutes,
     QLatin1String("pomodoro_long_break_interval_in_minutes"),
     &PomodoroConfig::longRestMinutes,
     PomodoroConfig::longRestMinutesRange,
     &PomodoroConfigUpdate::longRestMinutes},
    {PomodoroField::LongRestEvery,
     QLatin1String("pomodoro_long_break_every"),
     &PomodoroConfig::longRestEvery,
     PomodoroConfig::longRestEveryRange,
     &PomodoroConfigUpdate::longRestEvery},
};
}

bool PomodoroConfig::isValid() const
{
    return workMinutesRange.contains(workMinutes) && shortRestMinutesRange.contains(shortRestMinutes) && longRestMinutesRange.contains(longRestMinutes)
        && longRestEveryRange.contains(longRestEvery);
}

QString pomodoroPreferenceKey(PomodoroField field)
{
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        if (preference.field == field) {
            return preference.key;
        }
    }
    return QString();
}

std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    PomodoroConfig config;
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        const std::optional<qint64> minutes = integer(object.value(preference.key));
        if (minutes && *minutes >= preference.range.min && *minutes <= preference.range.max) {
            config.*preference.value = int(*minutes);
        }
    }
    return config;
}

QByteArray encodePomodoroConfigUpdate(const PomodoroConfigUpdate &update)
{
    QJsonObject object;
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        if (const std::optional<int> value = update.*preference.change) {
            object.insert(preference.key, *value);
        }
    }
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

}
