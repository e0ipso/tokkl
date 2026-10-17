import QtQuick
import QtTest

import Tokkl.Test

// The Configure page (configGeneral.qml) on a scripted wallet. Plasma's
// dialog disables Apply once saveConfig() returns and enables it again when
// the page emits configurationChanged.
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
