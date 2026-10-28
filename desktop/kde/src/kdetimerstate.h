#pragma once

// The timer state client as the KDE widget creates it from QML. The core's
// TimerStateClient takes its connection and clock when it is built, and QML
// can only set properties after an object exists, so this type takes the
// connection as a property and builds the client itself.

#include "clock.h"
#include "connection.h"
#include "timerstateclient.h"

#include <QObject>
#include <QPointer>

#include <memory>

namespace Tokkl
{

// Builds one TimerStateClient on the connection and a system clock, the
// client every part of the widget shares: the timer controller reads it and
// the Pomodoro session acts through it. The client is null until the
// connection is set. Setting another connection builds a new client and
// emits clientChanged(), so bindings that pass the client on follow; the
// widget never does that. The client does not outlive this object.
class KdeTimerState : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::Connection *connection READ connection WRITE setConnection NOTIFY connectionChanged)
    Q_PROPERTY(Tokkl::TimerStateClient *client READ client NOTIFY clientChanged)

public:
    explicit KdeTimerState(QObject *parent = nullptr);
    ~KdeTimerState() override;

    Connection *connection() const;
    void setConnection(Connection *connection);
    TimerStateClient *client() const;

Q_SIGNALS:
    void connectionChanged();
    void clientChanged();

private:
    // Declared first so it is destroyed last: the client reads it.
    SystemClock m_clock;
    QPointer<Connection> m_connection;
    std::unique_ptr<TimerStateClient> m_client;
};

}
