#include "macalarmplayer.h"

#import <AppKit/AppKit.h>

// Compiled with ARC.

namespace Tokkl
{

namespace
{
// The sound for file, or nil, with the reason logged, when NSSound cannot
// open it.
NSSound *openSound(const QString &file)
{
    NSSound *sound = [[NSSound alloc] initWithContentsOfFile:file.toNSString() byReference:YES];
    if (!sound) {
        qWarning("Tokkl: the alarm sound %s cannot play", qPrintable(file));
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
    d->loop = openSound(file);
    if (d->loop == nil) {
        return;
    }
    d->loop.loops = YES;
    [d->loop play];
}

void MacAlarmPlayer::stop()
{
    [d->loop stop];
    d->loop = nil;
    d->loopFile.clear();
}

void MacAlarmPlayer::preview(const QString &file)
{
    [d->preview stop];
    d->preview = openSound(file);
    [d->preview play];
}

}
