#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

// Build facts the widget shows and later tickets rely on.
class Companion : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    // The Tokkl release this build belongs to.
    Q_PROPERTY(QString version READ version CONSTANT)

public:
    explicit Companion(QObject *parent = nullptr);

    QString version() const;
};
