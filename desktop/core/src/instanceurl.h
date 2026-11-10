#pragma once

#include <QString>
#include <QUrl>

namespace Tokkl
{

// A path prefix such as https://example.com/tokkl is kept; API paths go under
// it.
struct InstanceUrl {
    QUrl base; // scheme, host, optional port and path prefix without a trailing slash
    QString error; // set when the text is not a usable instance URL

    bool isValid() const
    {
        return error.isEmpty() && base.isValid();
    }

    // Keys credentials and binds the validated account to the instance.
    QString key() const;

    // /api/v9 endpoint; a query may follow the path after "?".
    QUrl api(const QString &path) const;
    // /api/app endpoint; a query may follow the path after "?".
    QUrl app(const QString &path) const;
};

// Rejects user info, queries and fragments, so credentials never travel in
// the URL.
InstanceUrl parseInstanceUrl(const QString &text);

enum class AuthMode {
    Token,
    Password,
};

AuthMode authModeFromString(const QString &text);
QString authModeToString(AuthMode mode);

// Trims and lowercases ASCII A-Z only, as the server keys accounts.
QString normalizeEmail(const QString &email);

QString credentialKey(const InstanceUrl &instance, AuthMode mode, const QString &email);

// "<token>:api_token" or "<email>:<password>".
QByteArray basicAuthorization(AuthMode mode, const QString &email, const QString &secret);

}
