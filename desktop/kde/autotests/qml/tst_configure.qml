import QtQuick
import QtTest

import com.canpicasoft.tokkl.backend
import Tokkl.Test

// The Configure pages on a scripted wallet and network. Plasma's dialog
// disables Apply once saveConfig() returns and enables it again when the
// page emits configurationChanged or changes a cfg_ property.
Item {
    width: 500
    height: 700

    // The Connection page (configGeneral.qml).
    TestCase {
        id: testCase

        name: "Configure"
        when: windowShown
        visible: true
        width: 500
        height: 400

        readonly property string instance: "https://a.example.test/tokkl"

        property var page
        property QtObject setup

        WalletFixture {
            id: wallet
        }

        SignalSpy {
            id: changedSpy
            signalName: "configurationChanged"
        }

        SignalSpy {
            id: savedSpy
            signalName: "secretSaveFinished"
        }

        function init() {
            wallet.reset();
            const component = Qt.createComponent(Qt.resolvedUrl("../../package/contents/ui/configGeneral.qml"));
            compare(component.status, Component.Ready, component.errorString());
            page = createTemporaryObject(component, testCase, {
                cfg_instanceUrl: instance,
                cfg_authMode: "token"
            });
            verify(page);
            setup = wallet.setupOf(page);
            verify(setup, "the page has a connection setup");
            // The page reads the stored secret once the address settles.
            wait(500);
            tryCompare(setup, "busy", false);
            changedSpy.target = page;
            savedSpy.target = setup;
            changedSpy.clear();
            savedSpy.clear();
        }

        function test_monochromePreferenceBinding() {
            compare(page.cfg_monochromeIcon, false);
            const checkbox = findChild(page, "monochromeIcon");
            verify(checkbox);
            page.cfg_monochromeIcon = true;
            compare(checkbox.checked, true);
            checkbox.checked = false;
            compare(page.cfg_monochromeIcon, false);
        }

        // As the user typing a secret and pressing Apply.
        function applySecret(secret) {
            setup.editSecret(secret);
            page.saveConfig();
            savedSpy.wait(3000);
        }

        function test_refusedSaveAsksForApplyAgain() {
            wallet.setRefused(true);
            applySecret("tok-refused");
            compare(savedSpy.signalArguments[0][0], false);
            compare(changedSpy.count, 1, "the page asks for Apply again");
            compare(wallet.storedToken(instance), "");
            // The typed secret and the reason stay on the page for another try.
            compare(setup.secret, "tok-refused");
            verify(setup.walletError !== "");
            verify(setup.walletError.indexOf("tok-refused") < 0);

            // Apply again once the wallet works: saved, and nothing more to apply.
            wallet.setRefused(false);
            savedSpy.clear();
            changedSpy.clear();
            applySecret("tok-refused");
            compare(savedSpy.signalArguments[0][0], true);
            compare(changedSpy.count, 0);
            compare(wallet.storedToken(instance), "tok-refused");
            compare(setup.walletError, "");
        }

        function test_savedSecretLeavesApplyDisabled() {
            applySecret("tok-saved");
            compare(savedSpy.signalArguments[0][0], true);
            compare(wallet.storedToken(instance), "tok-saved");
            wait(50);
            compare(changedSpy.count, 0);
        }

        // Apply with nothing new to save writes nothing and asks for nothing.
        function test_nothingToSaveLeavesApplyDisabled() {
            page.saveConfig();
            compare(savedSpy.count, 1);
            compare(savedSpy.signalArguments[0][0], true);
            compare(wallet.writes, 0);
            wait(50);
            compare(changedSpy.count, 0);
        }
    }

    // The Pomodoro page (configPomodoro.qml). It reads and saves the
    // account's lengths through a connection of its own, and keeps the
    // sound of each transition in a cfg_ property.
    TestCase {
        id: pomodoroCase

        name: "ConfigurePomodoro"
        when: windowShown
        visible: true
        width: 500
        height: 700

        readonly property string instance: "https://p.example.test"
        readonly property var lengthNames: ["workMinutes", "shortRestMinutes", "longRestMinutes", "longRestEvery"]

        property var page
        property QtObject lengths
        property QtObject player

        WalletFixture {
            id: network
        }

        SignalSpy {
            id: pomodoroChangedSpy
            signalName: "configurationChanged"
        }

        function meBody() {
            return JSON.stringify({
                id: 3,
                email: "bea@example.test",
                fullname: "Bea",
                timezone: "UTC",
                default_workspace_id: 7
            });
        }

        // The whole preferences object, with a key of another client.
        function lengthsBody(work, shortRest, longRest, every) {
            return JSON.stringify({
                pomodoro_focus_interval_in_minutes: work,
                pomodoro_break_interval_in_minutes: shortRest,
                pomodoro_long_break_interval_in_minutes: longRest,
                pomodoro_long_break_every: every,
                theme: "dark"
            });
        }

        // Opens the page as Plasma does, with a token stored for the
        // instance unless token is empty. cached holds the four lengths the
        // panel last knew, as the widget's settings pass them; by default
        // the settings' defaults.
        function openPage(token, cached) {
            network.reset();
            if (token !== "") {
                network.storeToken(instance, token);
            }
            const known = cached || [25, 5, 15, 4];
            const component = Qt.createComponent(Qt.resolvedUrl("../../package/contents/ui/configPomodoro.qml"));
            compare(component.status, Component.Ready, component.errorString());
            page = createTemporaryObject(component, pomodoroCase, {
                cfg_instanceUrl: instance,
                cfg_authMode: "token",
                cfg_email: "",
                cfg_cachedWorkMinutes: known[0],
                cfg_cachedShortRestMinutes: known[1],
                cfg_cachedLongRestMinutes: known[2],
                cfg_cachedLongRestEvery: known[3],
                cfg_workToShortRestSound: "work-to-short-rest",
                cfg_shortRestToWorkSound: "short-rest-to-work",
                cfg_workToLongRestSound: "work-to-long-rest",
                cfg_longRestToWorkSound: "long-rest-to-work"
            });
            verify(page);
            lengths = network.lengthsOf(page);
            verify(lengths, "the page has its own lengths client");
            player = network.playerOf(page);
            verify(player, "the page has a sound player");
            pomodoroChangedSpy.target = page;
            pomodoroChangedSpy.clear();
        }

        // Answers the page's /me, then its read of the lengths.
        function connectPage(work, shortRest, longRest, every) {
            tryVerify(() => network.pending("GET", "/me") >= 0, 3000, "the page validates the account");
            network.respond(network.pending("GET", "/me"), 200, meBody());
            tryVerify(() => network.pending("GET", "/me/preferences") >= 0, 3000, "the page reads the lengths");
            network.respond(network.pending("GET", "/me/preferences"), 200, lengthsBody(work, shortRest, longRest, every));
        }

        function field(name) {
            const item = findChild(page, name);
            verify(item, name);
            return item;
        }

        function values() {
            return lengthNames.map(name => field(name).value);
        }

        function cachedValues() {
            return [page.cfg_cachedWorkMinutes, page.cfg_cachedShortRestMinutes, page.cfg_cachedLongRestMinutes, page.cfg_cachedLongRestEvery];
        }

        function verifyReadOnly() {
            for (const name of lengthNames) {
                verify(!field(name).enabled, name);
            }
        }

        // As the user pressing the up arrow in a length field.
        function stepUp(name) {
            const spinBox = findChild(field(name), "spinBox");
            verify(spinBox, name);
            spinBox.forceActiveFocus();
            keyClick(Qt.Key_Up);
        }

        function test_loadsLengthsFromServer() {
            openPage("tok-pomodoro", [40, 8, 20, 3]);
            // Until the server's lengths are read, the ones the panel last
            // knew show, read-only.
            compare(values(), [40, 8, 20, 3]);
            verifyReadOnly();
            tryVerify(() => network.pending("GET", "/me") >= 0, 3000, "the page validates the account");
            network.respond(network.pending("GET", "/me"), 200, meBody());
            tryVerify(() => network.pending("GET", "/me/preferences") >= 0, 3000, "the page reads the lengths");
            compare(values(), [40, 8, 20, 3]);
            verifyReadOnly();

            network.respond(network.pending("GET", "/me/preferences"), 200, lengthsBody(50, 10, 20, 3));
            compare(values(), [50, 10, 20, 3]);
            for (const name of lengthNames) {
                verify(field(name).enabled, name);
            }
            tryCompare(findChild(page, "lengthsNote"), "visible", false);
            // Loading changes no setting, so Apply stays off, and the
            // panel's lengths are left to the panel.
            compare(pomodoroChangedSpy.count, 0);
            compare(cachedValues(), [40, 8, 20, 3]);
        }

        function test_unreachableServerShowsTheCachedLengths() {
            openPage("tok-pomodoro", [40, 8, 20, 3]);
            tryVerify(() => network.pending("GET", "/me") >= 0, 3000, "the page validates the account");
            network.failNetwork(network.pending("GET", "/me"));
            tryCompare(lengths, "connecting", false);

            // The lengths the panel last knew, read-only, and why.
            compare(values(), [40, 8, 20, 3]);
            verifyReadOnly();
            const note = findChild(page, "lengthsNote");
            verify(note.visible);
            compare(note.text, "Changing the lengths needs a connection to your Tokkl server. Check the Connection page.");

            // Nothing to send and nothing to apply.
            page.saveConfig();
            compare(network.pending("POST", "/me/preferences"), -1);
            wait(50);
            compare(pomodoroChangedSpy.count, 0);
            compare(cachedValues(), [40, 8, 20, 3]);
        }

        function test_applyPostsOnlyTheChangedLength() {
            openPage("tok-pomodoro");
            connectPage(50, 10, 20, 3);
            stepUp("shortRestMinutes");
            compare(field("shortRestMinutes").value, 11);
            compare(pomodoroChangedSpy.count, 1, "a changed length turns Apply on");

            // A length changed on the web meanwhile shows in its untouched
            // field, and the typed one stays.
            lengths.preferences.refresh();
            network.respond(network.pending("GET", "/me/preferences"), 200, lengthsBody(45, 10, 20, 3));
            compare(values(), [45, 11, 20, 3]);

            page.saveConfig();
            const post = network.pending("POST", "/me/preferences");
            verify(post >= 0, "Apply sends the lengths");
            compare(network.requestBody(post), {
                pomodoro_break_interval_in_minutes: 11
            });
            network.respond(post, 200, lengthsBody(45, 11, 20, 3));
            compare(values(), [45, 11, 20, 3]);
            wait(50);
            compare(pomodoroChangedSpy.count, 1, "nothing is left to apply");

            // Saved, the field follows the server again, and Apply sends
            // nothing more.
            lengths.preferences.refresh();
            network.respond(network.pending("GET", "/me/preferences"), 200, lengthsBody(45, 12, 20, 3));
            compare(field("shortRestMinutes").value, 12);
            page.saveConfig();
            compare(network.pending("POST", "/me/preferences"), -1);
        }

        function test_refusedLengthShowsOnItsField() {
            openPage("tok-pomodoro");
            connectPage(50, 10, 20, 3);
            stepUp("longRestEvery");
            page.saveConfig();
            const post = network.pending("POST", "/me/preferences");
            compare(network.requestBody(post), {
                pomodoro_long_break_every: 4
            });
            const reason = "Invalid pomodoro_long_break_every: expected an integer from 1 to 12";
            network.respond(post, 400, JSON.stringify(reason));

            const error = findChild(field("longRestEvery"), "error");
            verify(error);
            compare(error.text, reason);
            verify(error.visible);
            for (const name of ["workMinutes", "shortRestMinutes", "longRestMinutes"]) {
                verify(!findChild(field(name), "error").visible, name);
            }
            // The typed value stays, and the dialog asks for Apply again.
            compare(field("longRestEvery").value, 4);
            compare(pomodoroChangedSpy.count, 2);

            // Accepted on the next Apply: the error goes.
            page.saveConfig();
            network.respond(network.pending("POST", "/me/preferences"), 200, lengthsBody(50, 10, 20, 4));
            verify(!error.visible);
            compare(field("longRestEvery").value, 4);
            wait(50);
            compare(pomodoroChangedSpy.count, 2);
        }

        function test_lengthsAreReadOnlyWithoutAnAccount() {
            // No secret stored, so the account is never validated.
            openPage("");
            tryCompare(lengths, "connecting", false);
            compare(values(), [25, 5, 15, 4]);
            for (const name of lengthNames) {
                verify(!field(name).enabled, name);
            }
            verify(findChild(page, "lengthsNote").visible);
            page.saveConfig();
            compare(network.pending("POST", "/me/preferences"), -1);
        }

        function test_lostServerKeepsTheLengthsReadOnly() {
            openPage("tok-pomodoro");
            connectPage(40, 8, 20, 3);
            stepUp("workMinutes");

            // The server stops answering. The account stays known, so the
            // lengths last read stay, but they cannot be changed.
            lengths.connection.refreshAccount();
            network.failNetwork(network.pending("GET", "/me"));
            compare(values(), [41, 8, 20, 3]);
            for (const name of lengthNames) {
                verify(!field(name).enabled, name);
            }
            tryCompare(findChild(page, "lengthsNote"), "visible", true);

            // Apply cannot send the typed length. It stays, and the page
            // asks for Apply again once Plasma has turned Apply off.
            pomodoroChangedSpy.clear();
            page.saveConfig();
            compare(network.pending("POST", "/me/preferences"), -1);
            compare(pomodoroChangedSpy.count, 0);
            tryCompare(pomodoroChangedSpy, "count", 1);
            compare(field("workMinutes").value, 41);
        }

        function test_soundChoiceSetsItsSetting() {
            openPage("");
            const combo = findChild(field("shortRestToWorkSound"), "sound");
            verify(combo);
            compare(combo.currentText, TokklPomodoroSounds.label("short-rest-to-work"));

            combo.forceActiveFocus();
            keyClick(Qt.Key_Down);
            const ids = TokklPomodoroSounds.sounds.map(sound => sound.id);
            compare(page.cfg_shortRestToWorkSound, ids[ids.indexOf("short-rest-to-work") + 1]);
            compare(page.cfg_workToShortRestSound, "work-to-short-rest");

            // A setting from Plasma shows in its picker. An id the catalogue
            // lacks shows the default of the transition, which the alarm
            // plays for it.
            page.cfg_workToLongRestSound = "short-rest-to-work";
            compare(findChild(field("workToLongRestSound"), "sound").currentText, TokklPomodoroSounds.label("short-rest-to-work"));
            page.cfg_longRestToWorkSound = "no-such-sound";
            compare(findChild(field("longRestToWorkSound"), "sound").currentText, TokklPomodoroSounds.label("long-rest-to-work"));
        }

        function test_previewPlaysTheChosenSound() {
            openPage("");
            compare(player.previewSource.toString(), "");
            page.cfg_workToShortRestSound = "long-rest-to-work";
            findChild(field("workToShortRestSound"), "preview").clicked();
            verify(player.previewSource.toString().endsWith("/pomodoro-long-rest-to-work.wav"), player.previewSource);

            page.cfg_workToLongRestSound = "no-such-sound";
            findChild(field("workToLongRestSound"), "preview").clicked();
            verify(player.previewSource.toString().endsWith("/pomodoro-work-to-long-rest.wav"), player.previewSource);
        }
    }
}
