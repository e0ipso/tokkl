#include "pomodorostore.h"

#include <QSettings>

namespace Tokkl
{

namespace
{
const QString modeKey = QStringLiteral("Pomodoro/pomodoroMode");

// An owner holds slashes and spaces, which QSettings reads as groups or
// escapes per format, and keys are case-insensitive on some platforms. Hex
// keeps each owner one lowercase key everywhere.
QString recordKey(const QString &owner)
{
    return QStringLiteral("Pomodoro/records/") + QString::fromLatin1(owner.toUtf8().toHex());
}
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

QByteArray SettingsPomodoroStore::loadRecord(const QString &owner)
{
    return m_settings->value(recordKey(owner)).toString().toUtf8();
}

bool SettingsPomodoroStore::saveRecord(const QString &owner, const QByteArray &json)
{
    const QString key = recordKey(owner);
    if (json.isEmpty()) {
        m_settings->remove(key);
    } else {
        m_settings->setValue(key, QString::fromUtf8(json));
    }
    return sync();
}

bool SettingsPomodoroStore::sync()
{
    m_settings->sync();
    return m_settings->status() == QSettings::NoError;
}

}
