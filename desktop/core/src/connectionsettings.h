#pragma once

#include <QLatin1StringView>
#include <QString>

class QSettings;

namespace Tokkl
{

class Connection;

// Never the secret, which only the credential store holds.
struct ConnectionSettings {
    static constexpr QLatin1StringView instanceUrlKey{"instanceUrl"};
    static constexpr QLatin1StringView authModeKey{"authMode"};
    static constexpr QLatin1StringView emailKey{"email"};

    QString instanceUrl;
    QString authMode = QStringLiteral("token"); // "token" or "password"
    QString email;

    // Token sign-in when settings names no method.
    static ConnectionSettings read(const QSettings &settings);
    // False when the write could not reach the file; the earlier values then
    // stay, also in memory.
    bool write(QSettings &settings) const;
    void applyTo(Connection &connection) const;

    bool operator==(const ConnectionSettings &other) const = default;
};

}
