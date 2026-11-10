#pragma once

// Plasma runs the Configure dialog in its own QML engine, so the page cannot
// use the panel's connection; this gives it one.

#include "connection.h"
#include "pomodoropreferences.h"

#include <QObject>

namespace Tokkl
{

// No length cache: it is per account, and the account is unknown until the
// connection validates it.
class PomodoroLengthsClient : public QObject
{
    Q_OBJECT

    Q_PROPERTY(Tokkl::Connection *connection READ connection CONSTANT)
    Q_PROPERTY(Tokkl::PomodoroPreferences *preferences READ preferences CONSTANT)
    Q_PROPERTY(bool connecting READ isConnecting NOTIFY connectingChanged)

public:
    explicit PomodoroLengthsClient(QObject *parent = nullptr);

    ~PomodoroLengthsClient() override;

    Connection *connection() const;
    PomodoroPreferences *preferences() const;
    bool isConnecting() const;

    // False when nothing was sent; otherwise saveAnswered() follows.
    Q_INVOKABLE bool save(int workMinutes, int shortRestMinutes, int longRestMinutes, int longRestEvery);

Q_SIGNALS:
    void connectingChanged();
    void saveAnswered();

protected:
    // Takes ownership of the connection.
    explicit PomodoroLengthsClient(Connection *connection, QObject *parent = nullptr);

private:
    Connection *m_connection;
    PomodoroPreferences *m_preferences;
    bool m_connecting = false;
};

}
