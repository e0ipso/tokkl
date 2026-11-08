#include "pomodorostore.h"

#include "settingswrite.h"

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
    return writeSettings(*m_settings, {{modeKey, pomodoro}});
}

}
