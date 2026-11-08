#pragma once

#include <QList>
#include <QString>
#include <QVariant>

#include <utility>

class QSettings;

namespace Tokkl
{

// Sets the values on settings and syncs the file, with what else settings
// holds unsaved. True when this write reached the file. Otherwise the keys
// keep the values they had, also in memory, and false comes back.
//
// QSettings keeps the first error it meets, so a long-lived settings object
// that failed once would report every later write as failed. The write goes
// through a settings object of its own on the same file or domain, and that
// object's status judges it. Objects on one file share their values within
// the process, so settings sees what was written.
bool writeSettings(QSettings &settings, const QList<std::pair<QString, QVariant>> &values);

}
