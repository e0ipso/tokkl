#pragma once

#include <QList>
#include <QString>
#include <QVariant>

#include <utility>

class QSettings;

namespace Tokkl
{

// QSettings keeps the first error it meets, so the write goes through a fresh
// object on the same file. On failure the keys keep their old values.
bool writeSettings(QSettings &settings, const QList<std::pair<QString, QVariant>> &values);

}
