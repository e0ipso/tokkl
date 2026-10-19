#pragma once

// The pause chain store the widget creates from QML: a group of the widget's
// own configuration, so a plasmashell restart keeps the chain total.

#include "chainstore.h"
#include "timercontroller.h"

#include <QPointer>

namespace Tokkl
{

// Keeps the chain in the PauseChain group of the applet's configuration,
// next to the group of its settings and outside the settings schema, so the
// Configure dialog never shows or writes it. Once both applet and timer are
// set, the store hands itself to the timer, which reads it with the next
// current entry. The store does not own either.
class AppletChainStore : public ChainStore
{
    Q_OBJECT

    // The Plasma::Applet, the widget's Plasmoid.
    Q_PROPERTY(QObject *applet READ applet WRITE setApplet NOTIFY appletChanged)
    Q_PROPERTY(Tokkl::TimerController *timer READ timer WRITE setTimer NOTIFY timerChanged)

public:
    explicit AppletChainStore(QObject *parent = nullptr);
    ~AppletChainStore() override;

    QObject *applet() const;
    void setApplet(QObject *applet);
    TimerController *timer() const;
    void setTimer(TimerController *timer);

    std::optional<PauseChain> load() override;
    void save(const std::optional<PauseChain> &chain) override;

Q_SIGNALS:
    void appletChanged();
    void timerChanged();

private:
    void attach();

    QPointer<QObject> m_applet;
    QPointer<TimerController> m_timer;
};

}
