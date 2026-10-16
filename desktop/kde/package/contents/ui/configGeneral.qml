import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami

import com.github.e0ipso.tokkl.backend

// Connection settings. The address, sign-in method and email are ordinary
// widget settings (cfg_*). The API token or password goes to KDE Wallet
// through TokklConnectionSetup and is never written to the configuration.
KCM.SimpleKCM {
    id: page

    property alias cfg_instanceUrl: urlField.text
    property string cfg_authMode: "token"
    property alias cfg_email: emailField.text

    // Tells the dialog that the secret changed, which no cfg_ property covers.
    signal configurationChanged()

    readonly property bool passwordMode: cfg_authMode === "password"
    readonly property string urlError: urlField.text.trim() === "" ? "" : setup.urlError(urlField.text)
    readonly property string secretKey: [urlField.text.trim(), cfg_authMode, passwordMode ? emailField.text.trim() : ""].join("\n")

    // The wallet entry the secret field was last loaded from or saved to.
    property string loadedKey: ""
    property string loadedSecret: ""
    property bool secretEdited: false
    property bool fillingSecret: false
    property string walletError: ""

    function fillSecret(text) {
        fillingSecret = true;
        secretField.text = text;
        fillingSecret = false;
    }

    function saveConfig() {
        if (urlError !== "" || urlField.text.trim() === "" || secretField.text === "") {
            return;
        }
        if (secretKey === loadedKey && secretField.text === loadedSecret) {
            return;
        }
        walletError = "";
        setup.saveSecret(urlField.text, cfg_authMode, emailField.text, secretField.text);
    }

    TokklConnectionSetup {
        id: setup

        property string pendingKey: ""
        property string pendingSecret: ""

        onSecretLoaded: secret => {
            page.walletError = "";
            page.loadedKey = pendingKey;
            page.loadedSecret = secret;
            // Keep what the user typed when nothing is stored for the new
            // address; Apply then saves it under that address.
            if (secret !== "" && !page.secretEdited) {
                page.fillSecret(secret);
            }
        }
        onSecretSaved: {
            page.loadedKey = page.secretKey;
            page.loadedSecret = secretField.text;
            page.secretEdited = false;
        }
        onWalletFailed: message => page.walletError = message
    }

    // Load the stored secret for the current address and account, once the
    // user stops typing.
    Timer {
        id: loadTimer
        interval: 400
        onTriggered: {
            if (page.urlError !== "" || urlField.text.trim() === "" || (page.passwordMode && emailField.text.trim() === "")) {
                return;
            }
            setup.pendingKey = page.secretKey;
            setup.loadSecret(urlField.text, page.cfg_authMode, emailField.text);
        }
    }
    onSecretKeyChanged: loadTimer.restart()
    Component.onCompleted: loadTimer.restart()

    Kirigami.FormLayout {
        QQC2.TextField {
            id: urlField
            Kirigami.FormData.label: i18nc("@label:textbox", "Instance URL:")
            placeholderText: "https://tokkl.example.com"
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoAutoUppercase
            Layout.fillWidth: true
        }

        QQC2.Label {
            visible: text !== ""
            text: page.urlError !== "" ? page.urlError
                : setup.isInsecure(urlField.text) ? i18n("This address uses plain http. Your token or password would be sent unencrypted.")
                : ""
            color: page.urlError !== "" ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.neutralTextColor
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }

        QQC2.RadioButton {
            Kirigami.FormData.label: i18nc("@label", "Sign in with:")
            text: i18nc("@option:radio", "API token")
            checked: !page.passwordMode
            onToggled: if (checked) page.cfg_authMode = "token"
        }

        QQC2.RadioButton {
            text: i18nc("@option:radio", "Email and password")
            checked: page.passwordMode
            onToggled: if (checked) page.cfg_authMode = "password"
        }

        QQC2.TextField {
            id: emailField
            visible: page.passwordMode
            Kirigami.FormData.label: i18nc("@label:textbox", "Email:")
            inputMethodHints: Qt.ImhEmailCharactersOnly | Qt.ImhNoAutoUppercase
            Layout.fillWidth: true
        }

        Kirigami.PasswordField {
            id: secretField
            Kirigami.FormData.label: page.passwordMode ? i18nc("@label:textbox", "Password:") : i18nc("@label:textbox", "API token:")
            placeholderText: page.passwordMode ? "" : i18n("From Settings → API token in Tokkl")
            Layout.fillWidth: true
            onTextChanged: {
                if (!page.fillingSecret) {
                    page.secretEdited = true;
                    page.configurationChanged();
                }
            }
        }

        QQC2.Label {
            text: i18n("Saved in KDE Wallet. Tokkl does not store it anywhere else.")
            font: Kirigami.Theme.smallFont
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }

        Kirigami.InlineMessage {
            visible: page.walletError !== ""
            type: Kirigami.MessageType.Error
            text: page.walletError
            Layout.fillWidth: true
        }

        RowLayout {
            Kirigami.FormData.isSection: false

            QQC2.Button {
                text: i18nc("@action:button", "Test Connection")
                icon.name: "network-connect"
                enabled: !setup.busy && urlField.text.trim() !== "" && page.urlError === "" && secretField.text !== ""
                onClicked: setup.testConnection(urlField.text, page.cfg_authMode, emailField.text, secretField.text)
            }

            QQC2.BusyIndicator {
                visible: setup.testResult === TokklConnectionSetup.Testing
                running: visible
                Layout.preferredHeight: Kirigami.Units.iconSizes.medium
            }
        }

        Kirigami.InlineMessage {
            visible: setup.testResult === TokklConnectionSetup.Succeeded || setup.testResult === TokklConnectionSetup.Failed
            type: setup.testResult === TokklConnectionSetup.Succeeded ? Kirigami.MessageType.Positive : Kirigami.MessageType.Error
            text: setup.testMessage
            Layout.fillWidth: true
        }
    }
}
