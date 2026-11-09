#pragma once

// QML names for the backend classes. The core classes live in the tokklcore
// library, which the tests link without QML. QML creates the KDE types from
// the tokklkde library, which inject KDE Wallet, the network and the
// widget's configuration. The core objects QML only reads, such as the
// connection, the timer and the session that TokklTimerState builds, have
// names it cannot create.

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

// The account connection of TokklTimerState, which QML configures through
// it.
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

// The timer state client the timer and the Pomodoro session share, which
// TokklTimerState builds.
struct TokklTimerStateClientForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerStateClient)
    QML_ANONYMOUS
};

// The widget's timer: the connection, the timer, the Pomodoro session and
// its preferences client, built together on one clock.
struct TokklTimerStateForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::KdeTimerState)
    QML_NAMED_ELEMENT(TokklTimerState)
};

// What TokklTimer is: the model the panel reads. It has no QML name of its
// own.
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

// Which of the menu's timer and session actions show and can be chosen, from
// the core's rules with the KDE panel's policy.
struct TokklMenuActionsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::MenuActions)
    QML_NAMED_ELEMENT(TokklMenuActions)
};

// Which parts the panel's words for the timer and the session show, in
// order, from the core's rules with the KDE panel's policy.
struct TokklStatusPartsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::StatusParts)
    QML_NAMED_ELEMENT(TokklStatusParts)
};

// Pomodoro mode. TokklTimerState builds the session and a preferences
// client, and TokklPomodoroLengths builds another preferences client for the
// Configure page; the two have QML names so the panel and the page can
// declare properties of their type, but only those types create them.
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

// The Configure page's own connection and preferences client for the
// lengths, since the page cannot reach the panel's.
struct TokklPomodoroLengthsForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::PomodoroLengthsClient)
    QML_NAMED_ELEMENT(TokklPomodoroLengths)
};

// The panel's word on the last Pomodoro lengths save of its account, which
// the Configure page hands to a process-wide owner so it outlives the
// dialog.
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
