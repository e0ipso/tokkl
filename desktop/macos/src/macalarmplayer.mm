#include "macalarmplayer.h"

#include "logging.h"

#include <QCoreApplication>

#import <AppKit/AppKit.h>

// Compiled with ARC.

namespace Tokkl
{

namespace
{
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::MacAlarmPlayer", text);
}

// The sound playing file, or nil, with the reason logged and in failure,
// when NSSound cannot open the file or the sound does not start.
NSSound *startSound(const QString &file, bool loops, QString *failure)
{
    NSSound *sound = [[NSSound alloc] initWithContentsOfFile:file.toNSString() byReference:YES];
    if (sound == nil) {
        qCWarning(Tokkl::lcAlarm) << "NSSound cannot open the alarm sound" << file;
        *failure = tr("%1 cannot be opened").arg(file);
        return nil;
    }
    sound.loops = loops ? YES : NO;
    if (![sound play]) {
        qCWarning(Tokkl::lcAlarm) << "NSSound does not play the alarm sound" << file;
        *failure = tr("%1 does not play").arg(file);
        return nil;
    }
    return sound;
}
}

struct MacAlarmPlayer::Private {
    NSSound *loop = nil;
    QString loopFile;
    NSSound *preview = nil;
};

MacAlarmPlayer::MacAlarmPlayer(QObject *parent)
    : AlarmPlayer(parent)
    , d(std::make_unique<Private>())
{
}

MacAlarmPlayer::~MacAlarmPlayer()
{
    [d->loop stop];
    [d->preview stop];
}

void MacAlarmPlayer::loop(const QString &file)
{
    if (file == d->loopFile && d->loop != nil && d->loop.playing) {
        return;
    }
    [d->loop stop];
    d->loopFile = file;
    QString failure;
    d->loop = startSound(file, true, &failure);
    if (!failure.isEmpty()) {
        reportFailure(failure);
    }
}

void MacAlarmPlayer::stop()
{
    [d->loop stop];
    d->loop = nil;
    d->loopFile.clear();
}

void MacAlarmPlayer::playOnce(const QString &file)
{
    [d->preview stop];
    QString failure;
    d->preview = startSound(file, false, &failure);
    if (!failure.isEmpty()) {
        reportFailure(failure);
    }
}

}
