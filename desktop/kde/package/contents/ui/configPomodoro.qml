import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami

import com.canpicasoft.tokkl.backend

// Pomodoro settings. The four lengths are the account's preferences on the
// Tokkl server, shared with the web app, so Apply sends the changed ones
// there. Until the page has read them, as when the server cannot be reached,
// it shows the ones the panel last knew, read-only. The sound of each
// transition is an ordinary widget setting (cfg_*).
KCM.SimpleKCM {
    id: page

    // The account as the Connection page saved it. This page only reads it.
    property string cfg_instanceUrl
    property string cfg_authMode: "token"
    property string cfg_email

    // The lengths the panel last knew, which it keeps in the widget's
    // settings with PomodoroLengthsCache. The page never changes them. Apply
    // still writes back the values the page opened with, and the panel then
    // restores its own.
    property int cfg_cachedWorkMinutes: 25
    property int cfg_cachedShortRestMinutes: 5
    property int cfg_cachedLongRestMinutes: 15
    property int cfg_cachedLongRestEvery: 4

    // A sound id per transition. The alarm plays the transition's default
    // for an id the catalogue does not have.
    property string cfg_workToShortRestSound: "work-to-short-rest"
    property string cfg_shortRestToWorkSound: "short-rest-to-work"
    property string cfg_workToLongRestSound: "work-to-long-rest"
    property string cfg_longRestToWorkSound: "long-rest-to-work"

    // Tells the dialog that a length changed, which no cfg_ property covers.
    signal configurationChanged()

    readonly property TokklPomodoroPreferences preferences: lengths.preferences
    // The page's connection has read the account's lengths. Until then the
    // preferences hold the defaults, so the fields show the cached lengths
    // and cannot be edited, and Apply cannot post a value nobody typed.
    property bool lengthsRead: false
    readonly property bool lengthsEditable: lengthsRead && preferences.editable && !preferences.saving
    readonly property var lengthFields: [workField, shortRestField, longRestField, everyField]
    // A save was sent and has not been answered yet.
    property bool saveSent: false

    // Plasma calls this on Apply, once it has saved the cfg_ properties. The
    // preferences client posts the lengths that differ from the server's.
    // The answer comes after Plasma has treated the page as saved, so a
    // refused save asks for Apply again, with the typed values and the
    // server's reason still on the page. OK closes the dialog before the
    // answer; Plasma gives a page no way to stop that.
    function saveConfig() {
        if (!lengthFields.some(field => field.edited)) {
            return;
        }
        if (!lengthsEditable) {
            // Nothing can be sent now. The typed values stay, and the page
            // asks for Apply again once Plasma has turned Apply off.
            Qt.callLater(page.configurationChanged);
        } else if (preferences.save(workField.value, shortRestField.value, longRestField.value, everyField.value)) {
            saveSent = true;
        } else {
            // The server already holds every typed value.
            lengthFields.forEach(field => field.reset());
        }
    }

    // Saved when the server now holds every value on the page.
    function finishSave() {
        saveSent = false;
        if (lengthFields.every(field => field.value === field.savedValue)) {
            lengthFields.forEach(field => field.reset());
        } else {
            configurationChanged();
        }
    }

    Connections {
        target: page.preferences
        function onStateChanged() {
            if (page.saveSent && !page.preferences.saving) {
                page.finishSave();
            }
        }
        function onRefreshed(ok) {
            if (ok) {
                page.lengthsRead = true;
            }
        }
    }

    // Another account, or the same one signed in again: its lengths are
    // read again, and the preferences show the defaults until then.
    Connections {
        target: lengths.connection
        function onGenerationChanged() {
            page.lengthsRead = false;
        }
    }

    // Plasma runs this page apart from the panel item, so it has a
    // connection of its own to the same account.
    TokklPomodoroLengths {
        id: lengths
        connection.instanceUrl: page.cfg_instanceUrl
        connection.authMode: page.cfg_authMode
        connection.email: page.cfg_email
    }

    // Plays a sound once for Preview.
    TokklAlarm {
        id: previewPlayer
    }

    // A length in whole units, from minimum to maximum. It shows the
    // server's value until the user changes it, and keeps the typed value
    // until the server holds it.
    component LengthField: GridLayout {
        id: lengthField

        required property int savedValue
        required property int minimum
        required property int maximum
        // The server's reason for refusing the typed value.
        required property string error
        property bool countsPomodoros: false
        property alias value: spinBox.value
        property bool edited: false

        signal modified()

        function reset() {
            edited = false;
            spinBox.value = savedValue;
        }

        onSavedValueChanged: {
            if (!edited) {
                spinBox.value = savedValue;
            }
        }
        Component.onCompleted: spinBox.value = savedValue

        Kirigami.FormData.buddyFor: spinBox
        Layout.fillWidth: true
        columns: 2
        columnSpacing: Kirigami.Units.smallSpacing
        rowSpacing: Kirigami.Units.smallSpacing

        QQC2.SpinBox {
            id: spinBox
            objectName: "spinBox"
            from: lengthField.minimum
            to: lengthField.maximum
            editable: true
            onValueModified: {
                lengthField.edited = true;
                lengthField.modified();
            }
        }

        QQC2.Label {
            text: lengthField.countsPomodoros
                ? i18ncp("@label unit after a number field", "pomodoro", "pomodoros", spinBox.value)
                : i18ncp("@label unit after a number field", "minute", "minutes", spinBox.value)
            Layout.fillWidth: true
        }

        QQC2.Label {
            objectName: "error"
            visible: text !== ""
            text: lengthField.error
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.Wrap
            Layout.columnSpan: 2
            Layout.fillWidth: true
        }
    }

    // The sound of one transition, and a button that plays it once.
    component SoundField: RowLayout {
        id: soundField

        // Such as "workToShortRest".
        required property string transition
        // The cfg_ value.
        required property string soundId
        required property TokklAlarm player
        // What the alarm plays for the transition.
        readonly property string effectiveSound: TokklPomodoroSounds.isSoundId(soundId) ? soundId : TokklPomodoroSounds.defaultSound(transition)

        signal chosen(string soundId)

        spacing: Kirigami.Units.smallSpacing

        QQC2.ComboBox {
            objectName: "sound"
            model: TokklPomodoroSounds.sounds
            textRole: "label"
            implicitContentWidthPolicy: QQC2.ComboBox.WidestText
            currentIndex: TokklPomodoroSounds.sounds.findIndex(sound => sound.id === soundField.effectiveSound)
            onActivated: index => soundField.chosen(TokklPomodoroSounds.sounds[index].id)
        }

        QQC2.Button {
            objectName: "preview"
            text: i18nc("@action:button play the sound once", "Preview")
            icon.name: "media-playback-start"
            onClicked: soundField.player.preview(soundField.effectiveSound)
        }
    }

    Kirigami.FormLayout {
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18nc("@title:group", "Lengths")
        }

        QQC2.Label {
            text: i18n("Saved on your Tokkl server and shared with Tokkl on the web.")
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }

        Kirigami.InlineMessage {
            objectName: "lengthsNote"
            visible: !page.preferences.editable
            type: Kirigami.MessageType.Information
            text: lengths.connecting ? i18n("Connecting to your Tokkl server…")
                : i18n("Changing the lengths needs a connection to your Tokkl server. Check the Connection page.")
            Layout.fillWidth: true
        }

        LengthField {
            id: workField
            objectName: "workMinutes"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Work:")
            enabled: page.lengthsEditable
            minimum: 1
            maximum: 180
            savedValue: page.lengthsRead ? page.preferences.workMinutes : page.cfg_cachedWorkMinutes
            error: page.preferences.workMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: shortRestField
            objectName: "shortRestMinutes"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Short rest:")
            enabled: page.lengthsEditable
            minimum: 1
            maximum: 60
            savedValue: page.lengthsRead ? page.preferences.shortRestMinutes : page.cfg_cachedShortRestMinutes
            error: page.preferences.shortRestMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: longRestField
            objectName: "longRestMinutes"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Long rest:")
            enabled: page.lengthsEditable
            minimum: 1
            maximum: 60
            savedValue: page.lengthsRead ? page.preferences.longRestMinutes : page.cfg_cachedLongRestMinutes
            error: page.preferences.longRestMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: everyField
            objectName: "longRestEvery"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Long rest every:")
            enabled: page.lengthsEditable
            minimum: 1
            maximum: 12
            countsPomodoros: true
            savedValue: page.lengthsRead ? page.preferences.longRestEvery : page.cfg_cachedLongRestEvery
            error: page.preferences.longRestEveryError
            onModified: page.configurationChanged()
        }

        // A failed read, or a refused save that names no field.
        Kirigami.InlineMessage {
            objectName: "lengthsError"
            visible: page.preferences.errorString !== ""
            type: Kirigami.MessageType.Error
            text: page.preferences.errorString
            Layout.fillWidth: true
        }

        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18nc("@title:group", "Sounds")
        }

        SoundField {
            objectName: "workToShortRestSound"
            Kirigami.FormData.label: i18nc("@label:listbox", "Work → short rest:")
            transition: "workToShortRest"
            soundId: page.cfg_workToShortRestSound
            player: previewPlayer
            onChosen: soundId => page.cfg_workToShortRestSound = soundId
        }

        SoundField {
            objectName: "shortRestToWorkSound"
            Kirigami.FormData.label: i18nc("@label:listbox", "Short rest → work:")
            transition: "shortRestToWork"
            soundId: page.cfg_shortRestToWorkSound
            player: previewPlayer
            onChosen: soundId => page.cfg_shortRestToWorkSound = soundId
        }

        SoundField {
            objectName: "workToLongRestSound"
            Kirigami.FormData.label: i18nc("@label:listbox", "Work → long rest:")
            transition: "workToLongRest"
            soundId: page.cfg_workToLongRestSound
            player: previewPlayer
            onChosen: soundId => page.cfg_workToLongRestSound = soundId
        }

        SoundField {
            objectName: "longRestToWorkSound"
            Kirigami.FormData.label: i18nc("@label:listbox", "Long rest → work:")
            transition: "longRestToWork"
            soundId: page.cfg_longRestToWorkSound
            player: previewPlayer
            onChosen: soundId => page.cfg_longRestToWorkSound = soundId
        }
    }
}
