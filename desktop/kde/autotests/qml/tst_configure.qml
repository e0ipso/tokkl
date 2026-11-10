import QtQuick
import QtTest

import com.canpicasoft.tokkl.backend
import Tokkl.Test

// Plasma's dialog disables Apply once saveConfig() returns and enables it
// again on configurationChanged or a cfg_ property change.
Item {
    width: 500
    height: 700

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
            compare(setup.secret, "tok-refused");
            verify(setup.walletError !== "");
            verify(setup.walletError.indexOf("tok-refused") < 0);

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

        function test_nothingToSaveLeavesApplyDisabled() {
            page.saveConfig();
            compare(savedSpy.count, 1);
            compare(savedSpy.signalArguments[0][0], true);
            compare(wallet.writes, 0);
            wait(50);
            compare(changedSpy.count, 0);
        }
    }

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

        Component {
            id: saveStatusComponent
            TokklLengthsSaveStatus {}
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

        // Includes a key of another client.
        function lengthsBody(work, shortRest, longRest, every) {
            return JSON.stringify({
                pomodoro_focus_interval_in_minutes: work,
                pomodoro_break_interval_in_minutes: shortRest,
                pomodoro_long_break_interval_in_minutes: longRest,
                pomodoro_long_break_every: every,
                theme: "dark"
            });
        }

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

        function stepUp(name) {
            const spinBox = findChild(field(name), "spinBox");
            verify(spinBox, name);
            spinBox.forceActiveFocus();
            keyClick(Qt.Key_Up);
        }

        function test_loadsLengthsFromServer() {
            openPage("tok-pomodoro", [40, 8, 20, 3]);
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
            compare(pomodoroChangedSpy.count, 0);
            compare(cachedValues(), [40, 8, 20, 3]);
        }

        function test_unreachableServerShowsTheCachedLengths() {
            openPage("tok-pomodoro", [40, 8, 20, 3]);
            tryVerify(() => network.pending("GET", "/me") >= 0, 3000, "the page validates the account");
            network.failNetwork(network.pending("GET", "/me"));
            tryCompare(lengths, "connecting", false);

            compare(values(), [40, 8, 20, 3]);
            verifyReadOnly();
            const note = findChild(page, "lengthsNote");
            verify(note.visible);
            compare(note.text, "Changing the lengths needs a connection to your Tokkl server. Check the Connection page.");

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
            network.refuse(post, "pomodoro_long_break_every", JSON.stringify(reason));

            const error = findChild(field("longRestEvery"), "error");
            verify(error);
            compare(error.text, reason);
            verify(error.visible);
            for (const name of ["workMinutes", "shortRestMinutes", "longRestMinutes"]) {
                verify(!findChild(field(name), "error").visible, name);
            }
            compare(field("longRestEvery").value, 4);
            compare(pomodoroChangedSpy.count, 2);

            page.saveConfig();
            network.respond(network.pending("POST", "/me/preferences"), 200, lengthsBody(50, 10, 20, 4));
            verify(!error.visible);
            compare(field("longRestEvery").value, 4);
            wait(50);
            compare(pomodoroChangedSpy.count, 2);
        }

        function test_refusalAfterTheDialogClosedReachesThePanel() {
            openPage("tok-pomodoro");
            connectPage(50, 10, 20, 3);
            const status = createTemporaryObject(saveStatusComponent, pomodoroCase, {
                connection: lengths.connection
            });
            compare(status.refusal, "");
            stepUp("workMinutes");
            page.saveConfig();
            const post = network.pending("POST", "/me/preferences");
            verify(post >= 0, "Apply sends the lengths");

            // QML reads the page's objects as null from here on; the save keeps the
            // C++ connection and preferences until the answer.
            page.destroy();
            tryVerify(() => lengths === null, 3000, "the page and its lengths client are gone");
            const reason = "Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180";
            network.refuse(post, "pomodoro_focus_interval_in_minutes", JSON.stringify(reason));
            compare(status.refusal, reason);

            openPage("tok-pomodoro");
            connectPage(50, 10, 20, 3);
            status.connection = lengths.connection;
            compare(status.refusal, reason);
            stepUp("workMinutes");
            page.saveConfig();
            compare(status.refusal, "");
            network.respond(network.pending("POST", "/me/preferences"), 200, lengthsBody(51, 10, 20, 3));
            compare(status.refusal, "");
        }

        function test_lengthsAreReadOnlyWithoutAnAccount() {
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

            lengths.connection.refreshAccount();
            network.failNetwork(network.pending("GET", "/me"));
            compare(values(), [41, 8, 20, 3]);
            for (const name of lengthNames) {
                verify(!field(name).enabled, name);
            }
            tryCompare(findChild(page, "lengthsNote"), "visible", true);

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
