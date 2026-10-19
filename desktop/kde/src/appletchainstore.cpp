#include "appletchainstore.h"

#include <KConfigGroup>
#include <Plasma/Applet>

namespace Tokkl
{

namespace
{
const QString group = QStringLiteral("PauseChain");
const QString ownerKey = QStringLiteral("owner");
const QString secondsKey = QStringLiteral("seconds");
const QString runningKey = QStringLiteral("runningId");
const QString descriptionKey = QStringLiteral("description");
const QString projectKey = QStringLiteral("projectId");
const QString taskKey = QStringLiteral("taskId");
const QString tagsKey = QStringLiteral("tags");
const QString billableKey = QStringLiteral("billable");

// An absent key is no id. Returns false for a value that is not a positive id.
bool readId(const KConfigGroup &config, const QString &key, std::optional<qint64> *id)
{
    id->reset();
    if (!config.hasKey(key)) {
        return true;
    }
    bool ok = false;
    const qint64 value = config.readEntry(key, QString()).toLongLong(&ok);
    if (!ok || value <= 0) {
        return false;
    }
    *id = value;
    return true;
}

void writeId(KConfigGroup &config, const QString &key, const std::optional<qint64> &id)
{
    if (id) {
        config.writeEntry(key, *id);
    } else {
        config.deleteEntry(key);
    }
}
}

AppletChainStore::AppletChainStore(QObject *parent)
    : ChainStore(parent)
{
}

AppletChainStore::~AppletChainStore()
{
    // The timer may outlive the store while QML tears the widget down.
    if (m_timer && m_timer->chainStore() == this) {
        m_timer->setChainStore(nullptr);
    }
}

QObject *AppletChainStore::applet() const
{
    return m_applet;
}

void AppletChainStore::setApplet(QObject *applet)
{
    if (applet == m_applet) {
        return;
    }
    m_applet = applet;
    Q_EMIT appletChanged();
    attach();
}

TimerController *AppletChainStore::timer() const
{
    return m_timer;
}

void AppletChainStore::setTimer(TimerController *timer)
{
    if (timer == m_timer) {
        return;
    }
    if (m_timer && m_timer->chainStore() == this) {
        m_timer->setChainStore(nullptr);
    }
    m_timer = timer;
    Q_EMIT timerChanged();
    attach();
}

void AppletChainStore::attach()
{
    if (m_timer && qobject_cast<Plasma::Applet *>(m_applet)) {
        m_timer->setChainStore(this);
    }
}

std::optional<PauseChain> AppletChainStore::load()
{
    auto *applet = qobject_cast<Plasma::Applet *>(m_applet);
    if (!applet) {
        return std::nullopt;
    }
    const KConfigGroup config = applet->config().group(group);
    if (!config.exists()) {
        return std::nullopt;
    }
    PauseChain chain;
    chain.owner = config.readEntry(ownerKey, QString());
    bool ok = false;
    chain.seconds = config.readEntry(secondsKey, QString()).toLongLong(&ok);
    bool valid = ok && chain.seconds >= 0 && !chain.owner.isEmpty();
    valid = readId(config, runningKey, &chain.runningId) && valid;
    valid = readId(config, projectKey, &chain.projectId) && valid;
    valid = readId(config, taskKey, &chain.taskId) && valid;
    chain.description = config.readEntry(descriptionKey, QString());
    chain.tags = config.readEntry(tagsKey, QStringList());
    chain.billable = config.readEntry(billableKey, false);
    return valid ? std::optional<PauseChain>(chain) : std::nullopt;
}

void AppletChainStore::save(const std::optional<PauseChain> &chain)
{
    auto *applet = qobject_cast<Plasma::Applet *>(m_applet);
    if (!applet) {
        return;
    }
    KConfigGroup config = applet->config().group(group);
    if (!chain) {
        config.deleteGroup();
        config.sync();
        return;
    }
    config.writeEntry(ownerKey, chain->owner);
    config.writeEntry(secondsKey, chain->seconds);
    writeId(config, runningKey, chain->runningId);
    config.writeEntry(descriptionKey, chain->description);
    writeId(config, projectKey, chain->projectId);
    writeId(config, taskKey, chain->taskId);
    config.writeEntry(tagsKey, chain->tags);
    config.writeEntry(billableKey, chain->billable);
    // Written now, so a plasmashell that does not quit cleanly keeps it.
    config.sync();
}

}
