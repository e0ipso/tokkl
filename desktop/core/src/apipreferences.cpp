#include "apitypes.h"

#include "apijson.h"

#include <QJsonDocument>

namespace Tokkl
{

using namespace Json;

namespace
{
struct PomodoroPreference {
    PomodoroField field;
    QLatin1String key;
    int PomodoroConfig::*value;
    std::optional<int> PomodoroConfigUpdate::*change;
};

const PomodoroPreference pomodoroPreferences[] = {
    {PomodoroField::WorkMinutes, QLatin1String("pomodoro_focus_interval_in_minutes"), &PomodoroConfig::workMinutes, &PomodoroConfigUpdate::workMinutes},
    {PomodoroField::ShortRestMinutes,
     QLatin1String("pomodoro_break_interval_in_minutes"),
     &PomodoroConfig::shortRestMinutes,
     &PomodoroConfigUpdate::shortRestMinutes},
    {PomodoroField::LongRestMinutes,
     QLatin1String("pomodoro_long_break_interval_in_minutes"),
     &PomodoroConfig::longRestMinutes,
     &PomodoroConfigUpdate::longRestMinutes},
    {PomodoroField::LongRestEvery, QLatin1String("pomodoro_long_break_every"), &PomodoroConfig::longRestEvery, &PomodoroConfigUpdate::longRestEvery},
};
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

std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value, const PomodoroLimits &limits)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    PomodoroConfig config = limits.defaults;
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        const PomodoroRange range = limits.range(preference.field);
        const std::optional<qint64> minutes = integer(object.value(preference.key));
        if (minutes && *minutes >= range.min && *minutes <= range.max) {
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
