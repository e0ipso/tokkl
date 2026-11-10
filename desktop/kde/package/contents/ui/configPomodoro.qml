import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami

import com.canpicasoft.tokkl.backend

// The lengths are server-side account preferences; until the page reads
// them it shows the panel's cached ones, read-only.
KCM.SimpleKCM {
    id: page

    // Read-only here.
    property string cfg_instanceUrl
    property string cfg_authMode: "token"
    property string cfg_email

    // Written by the panel's PomodoroLengthsCache; this page never changes
    // them.
    property int cfg_cachedWorkMinutes: 25
    property int cfg_cachedShortRestMinutes: 5
    property int cfg_cachedLongRestMinutes: 15
    property int cfg_cachedLongRestEvery: 4

    property string cfg_workToShortRestSound: "work-to-short-rest"
    property string cfg_shortRestToWorkSound: "short-rest-to-work"
    property string cfg_workToLongRestSound: "work-to-long-rest"
    property string cfg_longRestToWorkSound: "long-rest-to-work"

    // Tells the dialog that a length changed, which no cfg_ property covers.
    signal configurationChanged()

    readonly property TokklPomodoroPreferences preferences: lengths.preferences
    // Until true the preferences hold defaults, so the fields stay
    // read-only and Apply cannot post a value nobody typed.
    property bool lengthsRead: false
    readonly property bool lengthsEditable: lengthsRead && preferences.editable && !preferences.saving
    readonly property var lengthFields: [workField, shortRestField, longRestField, everyField]

    // The answer arrives after Plasma treats the page as saved, so a refusal
    // asks for Apply again. OK can close first; see pomodorolengthssaves.h.
    function saveConfig() {
        if (!lengthFields.some(field => field.edited)) {
            return;
        }
        if (!lengthsEditable) {
            // Re-arm Apply after Plasma has turned it off.
            Qt.callLater(page.configurationChanged);
        } else if (!lengths.save(workField.value, shortRestField.value, longRestField.value, everyField.value)) {
            lengthFields.forEach(field => field.reset());
        }
    }

    function finishSave() {
        if (lengthFields.every(field => field.value === field.savedValue)) {
            lengthFields.forEach(field => field.reset());
        } else {
            configurationChanged();
        }
    }

    Connections {
        target: lengths
        function onSaveAnswered() {
            page.finishSave();
        }
    }

    Connections {
        target: page.preferences
        function onRefreshed(ok) {
            if (ok) {
                page.lengthsRead = true;
            }
        }
    }

    Connections {
        target: lengths.connection
        function onGenerationChanged() {
            page.lengthsRead = false;
        }
    }

    // Plasma runs this page in its own engine, apart from the panel.
    TokklPomodoroLengths {
        id: lengths
        connection.instanceUrl: page.cfg_instanceUrl
        connection.authMode: page.cfg_authMode
        connection.email: page.cfg_email
    }

    TokklAlarm {
        id: previewPlayer
    }

    // Keeps the typed value until the server holds it.
    component LengthField: GridLayout {
        id: lengthField

        required property int savedValue
        required property int minimum
        required property int maximum
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

    component SoundField: RowLayout {
        id: soundField

        required property string transition
        required property string soundId
        required property TokklAlarm player
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
            minimum: page.preferences.limits.workMinutes.min
            maximum: page.preferences.limits.workMinutes.max
            savedValue: page.lengthsRead ? page.preferences.workMinutes : page.cfg_cachedWorkMinutes
            error: page.preferences.workMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: shortRestField
            objectName: "shortRestMinutes"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Short rest:")
            enabled: page.lengthsEditable
            minimum: page.preferences.limits.shortRestMinutes.min
            maximum: page.preferences.limits.shortRestMinutes.max
            savedValue: page.lengthsRead ? page.preferences.shortRestMinutes : page.cfg_cachedShortRestMinutes
            error: page.preferences.shortRestMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: longRestField
            objectName: "longRestMinutes"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Long rest:")
            enabled: page.lengthsEditable
            minimum: page.preferences.limits.longRestMinutes.min
            maximum: page.preferences.limits.longRestMinutes.max
            savedValue: page.lengthsRead ? page.preferences.longRestMinutes : page.cfg_cachedLongRestMinutes
            error: page.preferences.longRestMinutesError
            onModified: page.configurationChanged()
        }

        LengthField {
            id: everyField
            objectName: "longRestEvery"
            Kirigami.FormData.label: i18nc("@label:spinbox", "Long rest every:")
            enabled: page.lengthsEditable
            minimum: page.preferences.limits.longRestEvery.min
            maximum: page.preferences.limits.longRestEvery.max
            countsPomodoros: true
            savedValue: page.lengthsRead ? page.preferences.longRestEvery : page.cfg_cachedLongRestEvery
            error: page.preferences.longRestEveryError
            onModified: page.configurationChanged()
        }

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

        QQC2.Label {
            objectName: "soundError"
            visible: text !== ""
            text: previewPlayer.error
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }
    }
}
