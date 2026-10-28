#include "appletpomodorostore.h"

#include <KConfigGroup>
#include <Plasma/Applet>

namespace Tokkl
{

namespace
{
const QString group = QStringLiteral("Pomodoro");
const QString modeKey = QStringLiteral("mode");

Plasma::Applet *appletOf(QObject *object)
{
    return qobject_cast<Plasma::Applet *>(object);
}
}

AppletPomodoroStore::AppletPomodoroStore(QObject *parent)
    : PomodoroStore(parent)
{
}

QObject *AppletPomodoroStore::applet() const
{
    return m_applet;
}

void AppletPomodoroStore::setApplet(QObject *applet)
{
    if (applet == m_applet) {
        return;
    }
    m_applet = applet;
    Q_EMIT appletChanged();
}

bool AppletPomodoroStore::loadPomodoroMode()
{
    auto *applet = appletOf(m_applet);
    if (!applet) {
        return false;
    }
    return applet->config().group(group).readEntry(modeKey, false);
}

bool AppletPomodoroStore::savePomodoroMode(bool pomodoro)
{
    auto *applet = appletOf(m_applet);
    if (!applet) {
        return false;
    }
    KConfigGroup config = applet->config().group(group);
    config.writeEntry(modeKey, pomodoro);
    // Written now, so a plasmashell that does not quit cleanly keeps it.
    return config.sync();
}

}
