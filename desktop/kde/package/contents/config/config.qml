import QtQuick

import org.kde.plasma.configuration

ConfigModel {
    ConfigCategory {
        name: i18nc("@title:group configuration page", "Connection")
        icon: "network-connect"
        source: "configGeneral.qml"
    }
}
