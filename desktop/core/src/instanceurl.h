#pragma once

#include <QString>
#include <QUrl>

namespace Tokkl
{

// The configured address of a Tokkl server, normalized. A deployment path
// prefix such as https://example.com/tokkl is kept and API paths go under it.
struct InstanceUrl {
    QUrl base; // scheme, host, optional port and path prefix without a trailing slash
    QString error; // set when the text is not a usable instance URL

    bool isValid() const
    {
        return error.isEmpty() && base.isValid();
    }

    // Stable text for the instance, used to key credentials and bind the
    // validated account to it.
    QString key() const;

    // The URL of an /api/v9 endpoint, for example api(u"/me"). A query may
    // follow the path after "?".
    QUrl api(const QString &path) const;
    // The URL of one of Tokkl's own /api/app endpoints, such as
    // app(u"/timer"). A query may follow the path after "?".
    QUrl app(const QString &path) const;
};

// Accepts http and https URLs with a host. Rejects user info, queries and
// fragments, so credentials never travel inside the URL.
InstanceUrl parseInstanceUrl(const QString &text);

enum class AuthMode {
    Token,
    Password,
};

AuthMode authModeFromString(const QString &text);
QString authModeToString(AuthMode mode);

// Trim and lowercase ASCII A-Z only, the way the server keys accounts.
QString normalizeEmail(const QString &email);

// The credential store key for one instance and account. It holds no secret.
QString credentialKey(const InstanceUrl &instance, AuthMode mode, const QString &email);

// The value of an HTTP Basic Authorization header: "<token>:api_token" or
// "<email>:<password>".
QByteArray basicAuthorization(AuthMode mode, const QString &email, const QString &secret);

}
