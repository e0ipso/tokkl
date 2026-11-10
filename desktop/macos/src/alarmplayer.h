#pragma once

#include "alarmoutput.h"

#include <QObject>
#include <QString>

namespace Tokkl
{

// NSSound instead of Qt Multimedia, which would bundle FFmpeg into the DMG
// and cannot be built on the Linux test hosts. Tests use a fake.
class AlarmPlayer : public QObject, public AlarmOutput
{
    Q_OBJECT

public:
    using QObject::QObject;
};

}
