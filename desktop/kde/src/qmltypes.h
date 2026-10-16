#pragma once

// QML names for the backend classes. The core classes live in the tokklcore
// library, which the tests link without QML. QML creates the KDE types from
// the tokklkde library, which inject KDE Wallet and the network; the core
// classes they extend have no QML name.

#include "connection.h"
#include "connectionsetup.h"
#include "kdeconnection.h"
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

struct TokklTimerForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::TimerController)
    QML_NAMED_ELEMENT(TokklTimer)
};
