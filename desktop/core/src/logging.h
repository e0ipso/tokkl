#pragma once

#include <QLoggingCategory>

// Nothing logged may carry a secret: no Authorization header, token, password
// or credential key. URLs are logged without user info or query.
namespace Tokkl
{
Q_DECLARE_LOGGING_CATEGORY(lcNet)
Q_DECLARE_LOGGING_CATEGORY(lcAuth)
// By status only.
Q_DECLARE_LOGGING_CATEGORY(lcCredentials)
Q_DECLARE_LOGGING_CATEGORY(lcTimer)
Q_DECLARE_LOGGING_CATEGORY(lcAlarm)
Q_DECLARE_LOGGING_CATEGORY(lcTranslations)
}
