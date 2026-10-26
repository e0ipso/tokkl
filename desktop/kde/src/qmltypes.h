#pragma once

// QML names for the backend classes. The core classes live in the tokklcore
// library, which the tests link without QML. QML creates the KDE types from
// the tokklkde library, which inject KDE Wallet, the network and the
// widget's configuration; the core classes they extend have no QML name.

#include "alarmplayer.h"
#include "appletchainstore.h"
#include "appletpomodorostore.h"
#include "connection.h"
#include "connectionsetup.h"
#include "kdeconnection.h"
#include "kdepomodoro.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosoundcatalogue.h"
#include "pomodorostore.h"
#include "timercontroller.h"

#include <QtQml/qqmlregistration.h>

struct TokklCoreConnectionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::Connection)
    QML_ANONYMOUS
};

struct TokklCoreConnectionSetupForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::ConnectionSetup)
    QML_ANONYMOUS
};

struct TokklConnectionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdeConnection)
    QML_NAMED_ELEMENT(TokklConnection)
};

struct TokklConnectionSetupForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdeConnectionSetup)
    QML_NAMED_ELEMENT(TokklConnectionSetup)
};

struct TokklChainStoreForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::AppletChainStore)
    QML_NAMED_ELEMENT(TokklChainStore)
};

struct TokklTimerForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerController)
    QML_NAMED_ELEMENT(TokklTimer)
};

// Pomodoro mode. TokklPomodoro builds the session and the preferences
// client from its connection, timer and store; the two have QML names so
// the panel and the Configure page can declare properties of their type,
// but only TokklPomodoro creates them.
struct TokklPomodoroStoreForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroStore)
    QML_ANONYMOUS
};

struct TokklAppletPomodoroStoreForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::AppletPomodoroStore)
    QML_NAMED_ELEMENT(TokklPomodoroStore)
};

struct TokklPomodoroForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdePomodoro)
    QML_NAMED_ELEMENT(TokklPomodoro)
};

struct TokklPomodoroSessionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroSession)
    QML_NAMED_ELEMENT(TokklPomodoroSession)
    QML_UNCREATABLE("Created by TokklPomodoro")
};

struct TokklPomodoroPreferencesForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroPreferences)
    QML_NAMED_ELEMENT(TokklPomodoroPreferences)
    QML_UNCREATABLE("Created by TokklPomodoro")
};

struct TokklAlarmForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::AlarmPlayer)
    QML_NAMED_ELEMENT(TokklAlarm)
};

struct TokklPomodoroSoundsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroSoundCatalogue)
    QML_NAMED_ELEMENT(TokklPomodoroSounds)
    QML_SINGLETON
};
