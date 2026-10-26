#pragma once

#include <QByteArray>
#include <QObject>
#include <QString>

#include <memory>

class QSettings;

namespace Tokkl
{

// Where a device keeps Pomodoro mode across restarts: whether the mode is on,
// and per owner one record of JSON text that PomodoroRecord reads and writes.
// The store keeps the text as it is and checks nothing in it.
//
// A writer replaces the whole record, so it reads the record, changes its own
// part and writes it back.
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
    // The record stored for owner, or empty.
    virtual QByteArray loadRecord(const QString &owner) = 0;
    // An empty json removes the record. Returns false when it may not be
    // stored.
    virtual bool saveRecord(const QString &owner, const QByteArray &json) = 0;
};

// Keeps the mode and the records in a group of QSettings. A save returns true
// only once sync() wrote it without error.
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
    QByteArray loadRecord(const QString &owner) override;
    bool saveRecord(const QString &owner, const QByteArray &json) override;

private:
    bool sync();

    std::unique_ptr<QSettings> m_ownSettings;
    QSettings *m_settings = nullptr;
};

}
