#pragma once

#include "alarmplayer.h"

#include <memory>

namespace Tokkl
{

// One NSSound for the loop and one for the preview. A sound that cannot start
// is reported to the AlarmOutput failure handler.
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
