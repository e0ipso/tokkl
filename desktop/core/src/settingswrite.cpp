#include "settingswrite.h"

#include <QSettings>

#include <memory>

namespace Tokkl
{

namespace
{
// A settings object on the same file or domain as settings. Only the
// constructors that take an organization or application name give one; a
// settings object made on a file path has neither.
std::unique_ptr<QSettings> sameStore(const QSettings &settings)
{
    if (settings.organizationName().isEmpty() && settings.applicationName().isEmpty()) {
        return std::make_unique<QSettings>(settings.fileName(), settings.format());
    }
    return std::make_unique<QSettings>(settings.format(), settings.scope(), settings.organizationName(), settings.applicationName());
}
}

bool writeSettings(QSettings &settings, const QList<std::pair<QString, QVariant>> &values)
{
    const std::unique_ptr<QSettings> store = sameStore(settings);
    QList<std::pair<QString, QVariant>> before;
    for (const auto &[key, value] : values) {
        before.append({key, store->value(key)});
        store->setValue(key, value);
    }
    store->sync();
    if (store->status() == QSettings::NoError) {
        return true;
    }
    for (const auto &[key, value] : std::as_const(before)) {
        if (value.isValid()) {
            store->setValue(key, value);
        } else {
            store->remove(key);
        }
    }
    return false;
}

}
