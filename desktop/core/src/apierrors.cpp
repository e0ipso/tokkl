#include "apitypes.h"

#include "transport.h"

#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>

namespace Tokkl
{

namespace
{
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::Api", text);
}

// A server message fit for display: one line, bounded length.
QString serverMessage(const QByteArray &body)
{
    const std::optional<QJsonValue> value = parseJsonBody(body);
    if (!value || !value->isString()) {
        return QString();
    }
    QString message = value->toString().simplified();
    if (message.size() > 300) {
        message = message.left(300) + QStringLiteral("…");
    }
    return message;
}

QString redirectTarget(const QByteArray &location)
{
    const QUrl url(QString::fromLatin1(location));
    if (!url.isValid() || url.isRelative() || url.host().isEmpty()) {
        return tr("another address");
    }
    return url.adjusted(QUrl::RemoveUserInfo | QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment).toString();
}
}

std::optional<QJsonValue> parseJsonBody(const QByteArray &body)
{
    // QJsonDocument only accepts an object or array at the top level, so wrap
    // the body in one and require exactly one element.
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(QByteArrayLiteral("[") + body + QByteArrayLiteral("\n]"), &error);
    if (error.error != QJsonParseError::NoError || !document.isArray() || document.array().size() != 1) {
        return std::nullopt;
    }
    return document.array().first();
}

ApiError errorFromResponse(const HttpResponse &response)
{
    ApiError error;
    switch (response.outcome) {
    case HttpResponse::Outcome::Timeout:
        error.kind = ApiError::Kind::Timeout;
        error.message = tr("The Tokkl instance did not answer in time.");
        return error;
    case HttpResponse::Outcome::NetworkError:
    case HttpResponse::Outcome::Aborted:
        error.kind = ApiError::Kind::Network;
        error.message = response.errorString.isEmpty() ? tr("Could not reach the Tokkl instance.")
                                                        : tr("Could not reach the Tokkl instance: %1").arg(response.errorString);
        return error;
    case HttpResponse::Outcome::Finished:
        break;
    }

    error.status = response.status;
    const QString message = serverMessage(response.body);
    if (response.status >= 300 && response.status < 400) {
        error.kind = ApiError::Kind::Redirect;
        error.message = tr("The instance redirected the request to %1. Enter the final address as the instance URL.").arg(redirectTarget(response.location));
    } else if (response.status == 401) {
        error.kind = ApiError::Kind::Unauthorized;
        error.message = message.isEmpty() ? tr("The instance did not accept these credentials.") : message;
    } else if (response.status == 403) {
        error.kind = ApiError::Kind::Forbidden;
        error.message = message.isEmpty() ? tr("The instance refused the request.") : message;
    } else if (response.status == 429) {
        error.kind = ApiError::Kind::RateLimited;
        error.message = message.isEmpty() ? tr("Too many attempts. Try again later.") : message;
    } else if (response.status >= 500) {
        error.kind = ApiError::Kind::Server;
        error.message = tr("The Tokkl instance had an error (HTTP %1).").arg(response.status);
    } else if (response.status >= 400) {
        error.kind = ApiError::Kind::Client;
        error.message = message.isEmpty() ? tr("The instance rejected the request (HTTP %1).").arg(response.status) : message;
    } else {
        error.kind = ApiError::Kind::InvalidResponse;
        error.message = tr("The instance sent an unexpected response (HTTP %1).").arg(response.status);
    }
    return error;
}

ApiResult<Me> meFromResponse(const HttpResponse &response)
{
    if (response.outcome != HttpResponse::Outcome::Finished || response.status < 200 || response.status >= 300) {
        return ApiResult<Me>::failure(errorFromResponse(response));
    }
    const std::optional<QJsonValue> json = parseJsonBody(response.body);
    if (std::optional<Me> me = json ? decodeMe(*json) : std::nullopt) {
        return ApiResult<Me>::success(std::move(*me));
    }
    ApiError error;
    error.kind = ApiError::Kind::InvalidResponse;
    error.status = response.status;
    error.message = tr("The address did not answer like a Tokkl instance. Check the instance URL.");
    return ApiResult<Me>::failure(error);
}

}
