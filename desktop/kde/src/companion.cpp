#include "companion.h"

Companion::Companion(QObject *parent)
    : QObject(parent)
{
}

QString Companion::version() const
{
    return QStringLiteral(TOKKL_VERSION_STRING);
}
