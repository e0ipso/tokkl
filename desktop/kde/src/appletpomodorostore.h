#pragma once

// The Pomodoro store the widget creates from QML: a group of the widget's
// own configuration, so a plasmashell restart keeps the mode.

#include "pomodorostore.h"

#include <QPointer>

namespace Tokkl
{

// Keeps the mode in the Pomodoro group of the applet's configuration, next
// to the group of its settings and outside the settings schema, so the
// Configure dialog never shows or writes it. The session is the server's,
// so nothing else is stored. Entries that earlier versions wrote to the
// group are not read and not removed. Every write is synced at once. Without
// a Plasma::Applet nothing is stored and every save returns false. The store
// does not own the applet; TokklPomodoro (KdePomodoro) hands the store to the
// session it builds.
class AppletPomodoroStore : public PomodoroStore
{
    Q_OBJECT

    // The Plasma::Applet, the widget's Plasmoid.
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
