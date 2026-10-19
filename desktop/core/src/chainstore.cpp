#include "chainstore.h"

#include <QSettings>

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
bool readId(const QSettings &settings, const QString &key, std::optional<qint64> *id)
{
    id->reset();
    if (!settings.contains(key)) {
        return true;
    }
    bool ok = false;
    const qint64 value = settings.value(key).toLongLong(&ok);
    if (!ok || value <= 0) {
        return false;
    }
    *id = value;
    return true;
}

void writeId(QSettings &settings, const QString &key, const std::optional<qint64> &id)
{
    if (id) {
        settings.setValue(key, *id);
    } else {
        settings.remove(key);
    }
}
}

SettingsChainStore::SettingsChainStore(QSettings *settings, QObject *parent)
    : ChainStore(parent)
    , m_settings(settings)
{
    if (!m_settings) {
        m_ownSettings = std::make_unique<QSettings>();
        m_settings = m_ownSettings.get();
    }
}

SettingsChainStore::~SettingsChainStore() = default;

std::optional<PauseChain> SettingsChainStore::load()
{
    m_settings->beginGroup(group);
    PauseChain chain;
    chain.owner = m_settings->value(ownerKey).toString();
    bool ok = false;
    chain.seconds = m_settings->value(secondsKey).toLongLong(&ok);
    bool valid = ok && chain.seconds >= 0 && !chain.owner.isEmpty();
    valid = readId(*m_settings, runningKey, &chain.runningId) && valid;
    valid = readId(*m_settings, projectKey, &chain.projectId) && valid;
    valid = readId(*m_settings, taskKey, &chain.taskId) && valid;
    chain.description = m_settings->value(descriptionKey).toString();
    chain.tags = m_settings->value(tagsKey).toStringList();
    chain.billable = m_settings->value(billableKey).toBool();
    m_settings->endGroup();
    return valid ? std::optional<PauseChain>(chain) : std::nullopt;
}

void SettingsChainStore::save(const std::optional<PauseChain> &chain)
{
    if (!chain) {
        m_settings->remove(group);
        m_settings->sync();
        return;
    }
    m_settings->beginGroup(group);
    m_settings->setValue(ownerKey, chain->owner);
    m_settings->setValue(secondsKey, chain->seconds);
    writeId(*m_settings, runningKey, chain->runningId);
    m_settings->setValue(descriptionKey, chain->description);
    writeId(*m_settings, projectKey, chain->projectId);
    writeId(*m_settings, taskKey, chain->taskId);
    m_settings->setValue(tagsKey, chain->tags);
    m_settings->setValue(billableKey, chain->billable);
    m_settings->endGroup();
    m_settings->sync();
}

}
