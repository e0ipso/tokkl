#pragma once

#include "alarmplayer.h"

#include <memory>

namespace Tokkl
{

// The alarm through AppKit's NSSound: one sound for the loop, whose loops
// property keeps it going until stop(), and one for the preview. A file
// NSSound cannot open, or a sound that does not start, plays nothing; it is
// logged and reported to the AlarmOutput failure handler.
class MacAlarmPlayer : public AlarmPlayer
{
    Q_OBJECT

public:
    explicit MacAlarmPlayer(QObject *parent = nullptr);
    ~MacAlarmPlayer() override;

    void loop(const QString &file) override;
    void stop() override;
    void playOnce(const QString &file) override;

private:
    struct Private;
    std::unique_ptr<Private> d;
};

}
