#include "instanceurl.h"

#include <QCoreApplication>

namespace Tokkl
{

namespace
{
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::InstanceUrl", text);
}

InstanceUrl invalid(const QString &error)
{
    return InstanceUrl{QUrl(), error};
}
}

QString InstanceUrl::key() const
{
    return base.toString(QUrl::FullyEncoded);
}

QUrl InstanceUrl::api(const QString &path) const
{
    QUrl url = base;
    const qsizetype question = path.indexOf(QLatin1Char('?'));
    url.setPath(base.path(QUrl::FullyEncoded) + QStringLiteral("/api/v9") + path.left(question), QUrl::TolerantMode);
    if (question >= 0) {
        url.setQuery(path.mid(question + 1));
    }
    return url;
}

InstanceUrl parseInstanceUrl(const QString &text)
{
    const QString trimmed = text.trimmed();
    if (trimmed.isEmpty()) {
        return invalid(tr("Enter the address of your Tokkl instance."));
    }

    QUrl url(trimmed, QUrl::StrictMode);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || (scheme != QLatin1String("http") && scheme != QLatin1String("https"))) {
        return invalid(tr("Enter an http:// or https:// address, for example https://tokkl.example.com."));
    }
    if (url.host().isEmpty()) {
        return invalid(tr("The instance address has no host name."));
    }
    if (!url.userInfo().isEmpty()) {
        return invalid(tr("Remove the user name and password from the instance address. Enter credentials in their own fields."));
    }
    if (url.hasQuery() || url.hasFragment()) {
        return invalid(tr("Remove the query and fragment from the instance address."));
    }

    url.setScheme(scheme);
    if ((scheme == QLatin1String("http") && url.port() == 80) || (scheme == QLatin1String("https") && url.port() == 443)) {
        url.setPort(-1);
    }
    QString path = url.path(QUrl::FullyEncoded);
    while (path.endsWith(QLatin1Char('/'))) {
        path.chop(1);
    }
    url.setPath(path, QUrl::TolerantMode);
    return InstanceUrl{url, QString()};
}

AuthMode authModeFromString(const QString &text)
{
    return text == QLatin1String("password") ? AuthMode::Password : AuthMode::Token;
}

QString authModeToString(AuthMode mode)
{
    return mode == AuthMode::Password ? QStringLiteral("password") : QStringLiteral("token");
}

QString normalizeEmail(const QString &email)
{
    QString result = email.trimmed();
    for (QChar &c : result) {
        if (c >= QLatin1Char('A') && c <= QLatin1Char('Z')) {
            c = QChar(c.unicode() + ('a' - 'A'));
        }
    }
    return result;
}

QString credentialKey(const InstanceUrl &instance, AuthMode mode, const QString &email)
{
    if (mode == AuthMode::Token) {
        return QStringLiteral("token %1").arg(instance.key());
    }
    return QStringLiteral("password %1 %2").arg(instance.key(), normalizeEmail(email));
}

QByteArray basicAuthorization(AuthMode mode, const QString &email, const QString &secret)
{
    const QString pair = mode == AuthMode::Token ? QString(secret + QStringLiteral(":api_token")) : QString(email.trimmed() + QLatin1Char(':') + secret);
    return QByteArrayLiteral("Basic ") + pair.toUtf8().toBase64();
}

}
