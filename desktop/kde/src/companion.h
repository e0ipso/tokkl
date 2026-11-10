#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

class Companion : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    // The smoke load test compares it with the backend module's version.
    Q_PROPERTY(QString version READ version CONSTANT)

public:
    explicit Companion(QObject *parent = nullptr);

    QString version() const;
};
