// The smallest shell that can host an applet in a test: one screen and an
// empty containment, which Plasma creates when the requested plugin does not
// exist.

#pragma once

#include <Plasma/Corona>
#include <plasma_version.h>

#include <QRect>
#include <QtVersionChecks>

class TestCorona : public Plasma::Corona
{
public:
    // Plasma 6.8 takes the screen id as uint; earlier releases take int.
#if PLASMA_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    using ScreenId = uint;
#else
    using ScreenId = int;
#endif

    QRect screenGeometry(ScreenId) const override
    {
        return QRect(0, 0, 1280, 800);
    }
};
