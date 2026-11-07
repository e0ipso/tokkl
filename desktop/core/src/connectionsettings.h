#pragma once

#include <QLatin1StringView>
#include <QString>

class QSettings;

namespace Tokkl
{

class Connection;

// The connection settings a companion keeps in its own QSettings file: the
// instance address, the sign-in method and the email. Never the secret,
// which only the credential store holds.
struct ConnectionSettings {
    static constexpr QLatin1StringView instanceUrlKey{"instanceUrl"};
    static constexpr QLatin1StringView authModeKey{"authMode"};
    static constexpr QLatin1StringView emailKey{"email"};

    QString instanceUrl;
    QString authMode = QStringLiteral("token"); // "token" or "password"
    QString email;

    // What settings holds; token sign-in when it names no method.
    static ConnectionSettings read(const QSettings &settings);
    // Writes the three keys and syncs the file. False when the file could
    // not be written; the earlier values then stay, also in memory.
    bool write(QSettings &settings) const;
    void applyTo(Connection &connection) const;

    bool operator==(const ConnectionSettings &other) const = default;
};

}
