#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

// Build facts for the widget. `version` is the Tokkl release this build belongs to: the widget
// shows it in its tooltip, and the smoke load test compares it with the version the backend module
// was built with.
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
