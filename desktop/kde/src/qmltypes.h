#pragma once

// Foreign registrations keep tokklcore free of QML, since the tests link it
// without an engine.

#include "alarmplayer.h"
#include "connection.h"
#include "connectionsetup.h"
#include "kdeconnection.h"
#include "kdetimerstate.h"
#include "menuactions.h"
#include "pomodorolengthsclient.h"
#include "pomodorolengthssaves.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorosoundcatalogue.h"
#include "statuspresentation.h"
#include "timercontroller.h"

#include <QtQml/qqmlregistration.h>

struct TokklCoreConnectionSetupForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::ConnectionSetup)
    QML_ANONYMOUS
};

struct TokklConnectionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::Connection)
    QML_NAMED_ELEMENT(TokklConnection)
    QML_UNCREATABLE("Created by TokklTimerState")
};

struct TokklConnectionSetupForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdeConnectionSetup)
    QML_NAMED_ELEMENT(TokklConnectionSetup)
};

struct TokklTimerStateClientForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerStateClient)
    QML_ANONYMOUS
};

struct TokklTimerStateForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdeTimerState)
    QML_NAMED_ELEMENT(TokklTimerState)
};

struct TokklTimerModelForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerModel)
    QML_ANONYMOUS
};

struct TokklTimerForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerController)
    QML_NAMED_ELEMENT(TokklTimer)
    QML_UNCREATABLE("Created by TokklTimerState")
};

struct TokklMenuActionsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::MenuActions)
    QML_NAMED_ELEMENT(TokklMenuActions)
};

struct TokklStatusPartsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::StatusParts)
    QML_NAMED_ELEMENT(TokklStatusParts)
};

// Named so QML can declare properties of these types; only TokklTimerState
// and TokklPomodoroLengths create them.
struct TokklPomodoroSessionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroSession)
    QML_NAMED_ELEMENT(TokklPomodoroSession)
    QML_UNCREATABLE("Created by TokklTimerState")
};

struct TokklPomodoroPreferencesForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroPreferences)
    QML_NAMED_ELEMENT(TokklPomodoroPreferences)
    QML_UNCREATABLE("Created by TokklTimerState and TokklPomodoroLengths")
};

struct TokklPomodoroLengthsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroLengthsClient)
    QML_NAMED_ELEMENT(TokklPomodoroLengths)
};

struct TokklLengthsSaveStatusForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroLengthsSaveStatus)
    QML_NAMED_ELEMENT(TokklLengthsSaveStatus)
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
