import QtQml

import com.canpicasoft.tokkl.backend

// Writes only while the connection knows the account, so offline defaults
// never replace cached values. Writes only changed values, so it settles.
QtObject {
    id: cache

    // Plasmoid.configuration.
    required property QtObject configuration
    required property TokklConnection connection
    property TokklPomodoroPreferences preferences: null

    readonly property var keys: ["cachedWorkMinutes", "cachedShortRestMinutes", "cachedLongRestMinutes", "cachedLongRestEvery"]
    readonly property var known: preferences !== null && connection !== null && connection.connected
        ? [preferences.workMinutes, preferences.shortRestMinutes, preferences.longRestMinutes, preferences.longRestEvery]
        : null
    readonly property var stored: configuration !== null ? keys.map(key => configuration[key]) : null

    function keep() {
        if (known === null || configuration === null) {
            return;
        }
        let changed = false;
        keys.forEach((key, i) => {
            if (configuration[key] !== known[i]) {
                configuration[key] = known[i];
                changed = true;
            }
        });
        if (changed) {
            configuration.writeConfig();
        }
    }

    // Deferred so the preferences follow a new account first.
    onKnownChanged: Qt.callLater(cache.keep)
    onStoredChanged: Qt.callLater(cache.keep)
}
