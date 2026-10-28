import QtQml

import com.canpicasoft.tokkl.backend

// Keeps the account's Pomodoro lengths, as the panel last knew them, in four
// widget settings: cachedWorkMinutes, cachedShortRestMinutes,
// cachedLongRestMinutes and cachedLongRestEvery. The Pomodoro settings page
// runs apart from the panel item, with its own connection, and shows these
// until that connection has read the server's.
//
// The cache writes only while the connection knows the account. Before
// then, as after an offline start, the preferences show the defaults, and
// those must not replace what an earlier run kept. Apply on the settings
// page writes back the values the page opened with, so the cache puts the
// account's values back. It writes a setting only when the value differs,
// so its own writes end there.
QtObject {
    id: cache

    // Plasmoid.configuration: the settings, and writeConfig() to save them.
    required property QtObject configuration
    required property TokklConnection connection
    // Null until the backend has built it.
    property TokklPomodoroPreferences preferences: null

    readonly property var keys: ["cachedWorkMinutes", "cachedShortRestMinutes", "cachedLongRestMinutes", "cachedLongRestEvery"]
    // The account's lengths, or null while the account is unknown.
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

    // Later, so the preferences have followed a new account first.
    onKnownChanged: Qt.callLater(cache.keep)
    onStoredChanged: Qt.callLater(cache.keep)
}
