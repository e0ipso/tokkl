#pragma once

// QML names for the backend classes. The classes live in the tokklcore
// library, which the tests link without QML.

#include "connection.h"
#include "connectionsetup.h"

#include <QtQml/qqmlregistration.h>

struct TokklConnectionForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::Connection)
    QML_NAMED_ELEMENT(TokklConnection)
};

struct TokklConnectionSetupForeign {
    Q_GADGET
    QML_FOREIGN(Tokkl::ConnectionSetup)
    QML_NAMED_ELEMENT(TokklConnectionSetup)
};
