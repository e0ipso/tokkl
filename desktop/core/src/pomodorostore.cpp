#include "pomodorostore.h"

#include <QSettings>

namespace Tokkl
{

namespace
{
const QString modeKey = QStringLiteral("Pomodoro/pomodoroMode");
}

SettingsPomodoroStore::SettingsPomodoroStore(QSettings *settings, QObject *parent)
    : PomodoroStore(parent)
    , m_settings(settings)
{
    if (!m_settings) {
        m_ownSettings = std::make_unique<QSettings>();
        m_settings = m_ownSettings.get();
    }
}

SettingsPomodoroStore::~SettingsPomodoroStore() = default;

bool SettingsPomodoroStore::loadPomodoroMode()
{
    return m_settings->value(modeKey, false).toBool();
}

bool SettingsPomodoroStore::savePomodoroMode(bool pomodoro)
{
    m_settings->setValue(modeKey, pomodoro);
    return sync();
}

bool SettingsPomodoroStore::sync()
{
    m_settings->sync();
    return m_settings->status() == QSettings::NoError;
}

}
