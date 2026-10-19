#pragma once

#include <QObject>
#include <QString>
#include <QStringList>

#include <memory>
#include <optional>

class QSettings;

namespace Tokkl
{

// The entries a pause and resume produce: the seconds the stopped ones stored,
// the running clone when there is one, and what a resume copies from the
// entry that was paused.
struct PauseChain {
    // The instance, account and workspace the chain belongs to.
    QString owner;
    // The durations the server stored for the chain's stopped entries.
    qint64 seconds = 0;
    // The running clone; empty while paused.
    std::optional<qint64> runningId;

    QString description;
    std::optional<qint64> projectId;
    std::optional<qint64> taskId;
    QStringList tags;
    bool billable = false;

    bool isPaused() const
    {
        return !runningId.has_value();
    }

    bool operator==(const PauseChain &other) const = default;
};

// Where a timer keeps its pause chain, so a restart keeps the total.
class ChainStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // The stored chain, or nullopt when none is stored or it is unreadable.
    virtual std::optional<PauseChain> load() = 0;
    // nullopt removes the stored chain.
    virtual void save(const std::optional<PauseChain> &chain) = 0;
};

// Keeps the chain in a group of QSettings.
class SettingsChainStore : public ChainStore
{
    Q_OBJECT

public:
    // Uses settings, which the store does not own, or the application's
    // default QSettings when it is null.
    explicit SettingsChainStore(QSettings *settings = nullptr, QObject *parent = nullptr);
    ~SettingsChainStore() override;

    std::optional<PauseChain> load() override;
    void save(const std::optional<PauseChain> &chain) override;

private:
    std::unique_ptr<QSettings> m_ownSettings;
    QSettings *m_settings = nullptr;
};

}
