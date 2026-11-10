#pragma once

#include "pomodorostore.h"

#include <QPointer>

namespace Tokkl
{

// Uses the applet's Pomodoro config group, outside the settings schema so the
// Configure dialog never shows it. Without an applet every save returns false.
class AppletPomodoroStore : public PomodoroStore
{
    Q_OBJECT

    // A Plasma::Applet.
    Q_PROPERTY(QObject *applet READ applet WRITE setApplet NOTIFY appletChanged)

public:
    explicit AppletPomodoroStore(QObject *parent = nullptr);

    QObject *applet() const;
    void setApplet(QObject *applet);

    bool loadPomodoroMode() override;
    bool savePomodoroMode(bool pomodoro) override;

Q_SIGNALS:
    void appletChanged();

private:
    QPointer<QObject> m_applet;
};

}
