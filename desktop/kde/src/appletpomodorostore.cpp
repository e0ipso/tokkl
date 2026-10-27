#include "appletpomodorostore.h"

#include <KConfigGroup>
#include <Plasma/Applet>

#include <QCryptographicHash>

namespace Tokkl
{

namespace
{
const QString group = QStringLiteral("Pomodoro");
const QString modeKey = QStringLiteral("mode");

// The key of an owner's record: the owner holds a URL and spaces, so its
// SHA-1 in hex stands in for it.
QString recordKey(const QString &owner)
{
    const QByteArray digest = QCryptographicHash::hash(owner.toUtf8(), QCryptographicHash::Sha1);
    return QStringLiteral("record-") + QString::fromLatin1(digest.toHex());
}

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

QByteArray AppletPomodoroStore::loadRecord(const QString &owner)
{
    auto *applet = appletOf(m_applet);
    if (!applet) {
        return QByteArray();
    }
    return applet->config().group(group).readEntry(recordKey(owner), QString()).toUtf8();
}

bool AppletPomodoroStore::saveRecord(const QString &owner, const QByteArray &json)
{
    auto *applet = appletOf(m_applet);
    if (!applet) {
        return false;
    }
    KConfigGroup config = applet->config().group(group);
    if (json.isEmpty()) {
        config.deleteEntry(recordKey(owner));
    } else {
        config.writeEntry(recordKey(owner), QString::fromUtf8(json));
    }
    return config.sync();
}

}
