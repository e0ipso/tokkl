#pragma once

#include <QLoggingCategory>

// The core's logging categories. Each logs at Info and above by default;
// QT_LOGGING_RULES="tokkl.*.debug=true" adds the per-request lines.
//
// Nothing logged may carry a secret: no Authorization header, token,
// password or credential key. URLs are logged without user info or query.
namespace Tokkl
{
// Requests, answers, cooldowns and the event stream.
Q_DECLARE_LOGGING_CATEGORY(lcNet)
// The connection's state: validation, refused credentials, generations.
Q_DECLARE_LOGGING_CATEGORY(lcAuth)
// Reads and writes of the credential store, by status only.
Q_DECLARE_LOGGING_CATEGORY(lcCredentials)
// Timer and Pomodoro actions and their outcomes.
Q_DECLARE_LOGGING_CATEGORY(lcTimer)
// The Pomodoro alarm: sound files and choices.
Q_DECLARE_LOGGING_CATEGORY(lcAlarm)
}
