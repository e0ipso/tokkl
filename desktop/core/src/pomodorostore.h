#pragma once

#include <QObject>

#include <memory>

class QSettings;

namespace Tokkl
{

// Where a device keeps Pomodoro mode across restarts. The session itself is
// the server's, and the platforms keep the per-transition sound picks with
// their other settings.
class PomodoroStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // True for Pomodoro mode; false, also when nothing is stored, for Timer
    // mode.
    virtual bool loadPomodoroMode() = 0;
    // Returns false when the choice may not be stored.
    virtual bool savePomodoroMode(bool pomodoro) = 0;

Q_SIGNALS:
    // The store reads another place now, so loadPomodoroMode() may answer
    // differently from before.
    void sourceChanged();
};

// Keeps the mode in a group of QSettings. A save returns true only once
// this save reached the file (see writeSettings()); a refused one keeps the
// mode stored before.
class SettingsPomodoroStore : public PomodoroStore
{
    Q_OBJECT

public:
    // Uses settings, which the store does not own, or the application's
    // default QSettings when it is null.
    explicit SettingsPomodoroStore(QSettings *settings = nullptr, QObject *parent = nullptr);
    ~SettingsPomodoroStore() override;

    bool loadPomodoroMode() override;
    bool savePomodoroMode(bool pomodoro) override;

private:
    std::unique_ptr<QSettings> m_ownSettings;
    QSettings *m_settings = nullptr;
};

}
