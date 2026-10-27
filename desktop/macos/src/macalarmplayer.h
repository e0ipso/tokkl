#pragma once

#include "alarmplayer.h"

#include <memory>

namespace Tokkl
{

// The alarm through AppKit's NSSound: one sound for the loop, whose loops
// property keeps it going until stop(), and one for the preview. A file
// NSSound cannot open is logged and plays nothing.
class MacAlarmPlayer : public AlarmPlayer
{
    Q_OBJECT

public:
    explicit MacAlarmPlayer(QObject *parent = nullptr);
    ~MacAlarmPlayer() override;

    void loop(const QString &file) override;
    void stop() override;
    void preview(const QString &file) override;

private:
    struct Private;
    std::unique_ptr<Private> d;
};

}
