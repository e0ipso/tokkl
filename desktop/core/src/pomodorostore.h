#pragma once

#include <QObject>

#include <memory>

class QSettings;

namespace Tokkl
{

// Keeps only the per-device Pomodoro mode; the session is the server's.
class PomodoroStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // False, also when nothing is stored, means Timer mode.
    virtual bool loadPomodoroMode() = 0;
    // False when the choice may not be stored.
    virtual bool savePomodoroMode(bool pomodoro) = 0;

Q_SIGNALS:
    // loadPomodoroMode() may now answer differently.
    void sourceChanged();
};

// A save returns true only once it reached the file (writeSettings()); a
// refused one keeps the mode stored before.
class SettingsPomodoroStore : public PomodoroStore
{
    Q_OBJECT

public:
    // settings is not owned; null means the application's default QSettings.
    explicit SettingsPomodoroStore(QSettings *settings = nullptr, QObject *parent = nullptr);
    ~SettingsPomodoroStore() override;

    bool loadPomodoroMode() override;
    bool savePomodoroMode(bool pomodoro) override;

private:
    std::unique_ptr<QSettings> m_ownSettings;
    QSettings *m_settings = nullptr;
};

}
