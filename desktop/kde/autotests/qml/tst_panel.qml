import QtQuick
import QtTest
import org.kde.kirigami as Kirigami

import com.github.e0ipso.tokkl.backend
import Tokkl.Test

import "../../package/contents/ui"

// The panel item and its menu, against a scripted instance. Every request
// goes to the fake transport in PanelFixture; time comes from its fake clock.
// The instance answers with timer states, as the server does, and the panel
// follows them whichever device caused the change.
TestCase {
    id: testCase

    name: "Panel"
    when: windowShown
    // TestCase hides itself; the panel item must be visible to take clicks
    // and focus.
    visible: true
    width: 400
    height: 60

    readonly property string instanceA: "https://a.example.test/tokkl"
    readonly property string instanceB: "https://b.example.test"

    property PanelFixture fixture
    property PanelButton button
    // Kirigami.Units.longDuration before a test changed it, or -1.
    property int longDurationBefore: -1

    Component {
        id: fixtureComponent
        PanelFixture {}
    }

    Component {
        id: buttonComponent
        PanelButton {}
    }

    // Stands in for Plasmoid.configuration: the four cached lengths, as an
    // earlier run left them, and the call that saves the settings.
    Component {
        id: settingsComponent
        QtObject {
            property int cachedWorkMinutes: 40
            property int cachedShortRestMinutes: 8
            property int cachedLongRestMinutes: 20
            property int cachedLongRestEvery: 3
            property int saves: 0

            function writeConfig() {
                saves++;
            }
        }
    }

    Component {
        id: lengthsCacheComponent
        PomodoroLengthsCache {}
    }

    SignalSpy {
        id: openSpy
        signalName: "openRequested"
    }

    SignalSpy {
        id: configureSpy
        signalName: "configureRequested"
    }

    // ----- scripted instance ---------------------------------------------

    function meBody(user, workspace) {
        return JSON.stringify({
            id: user,
            email: "bea@example.test",
            fullname: "Bea",
            timezone: "UTC",
            default_workspace_id: workspace,
            beginning_of_week: 1
        });
    }

    function project(id, workspace, name, billable, active) {
        return {
            id: id,
            workspace_id: workspace,
            client_id: null,
            client_name: null,
            name: name,
            color: "#06aaf5",
            active: active === undefined ? true : active,
            billable: billable
        };
    }

    // A running entry with metadata the panel must never send back.
    function entry(id, workspace, projectId, billable, extra) {
        const start = fixture.clockIso(-65);
        const body = {
            id: id,
            workspace_id: workspace,
            project_id: projectId,
            task_id: projectId === null ? null : 41,
            billable: billable,
            start: start,
            stop: null,
            duration: -Math.floor(Date.parse(start) / 1000),
            description: "Write the report",
            tags: ["deep work", "q4"]
        };
        return Object.assign(body, extra || {});
    }

    function waitFor(method, suffix) {
        tryVerify(() => fixture.pending(method, suffix) >= 0, 3000, method + " " + suffix);
        return fixture.pending(method, suffix);
    }

    function answer(method, suffix, status, body) {
        const index = waitFor(method, suffix);
        fixture.respond(index, status, typeof body === "string" ? body : JSON.stringify(body));
        return index;
    }

    // The revision of the newest state built. The server raises it with every
    // change to the running entry, the pause chain or the session.
    property int revision: 0

    // A timer state as the server sends it: GET /api/app/timer, a timer
    // action's reply and an event. running is the running entry or null.
    function stateBody(running, pause, pomodoro, discarded) {
        return JSON.stringify({
            revision: ++revision,
            server_time: fixture.clockIso(),
            running_entry: running === undefined ? null : running,
            pause: pause === undefined ? null : pause,
            pomodoro: pomodoro === undefined ? null : pomodoro,
            discarded_pomodoro: discarded === undefined ? null : discarded
        });
    }

    // Answers the newest state read with the next state.
    function answerState(running, pause, pomodoro, discarded) {
        const index = waitFor("GET", "/app/timer");
        fixture.respond(index, 200, stateBody(running, pause, pomodoro, discarded));
        return index;
    }

    // The pause chain of a stopped entry like entry()'s, with the seconds the
    // server stored for it. A running clone has cloneId.
    function pauseChain(paused, seconds, cloneId, projectId, billable) {
        return {
            paused: paused,
            seconds: seconds,
            workspace_id: 7,
            description: "Write the report",
            project_id: projectId === undefined ? null : projectId,
            task_id: projectId === undefined || projectId === null ? null : 41,
            tag_ids: [3, 5],
            tags: ["deep work", "q4"],
            billable: billable === undefined ? false : billable,
            clone_entry_id: cloneId === undefined ? null : cloneId
        };
    }

    // A Pomodoro session in a phase that started startOffset seconds from now,
    // with the lengths 25, 5 and 15 minutes.
    function pomodoroSession(kind, startOffset, number, every) {
        const lengths = {
            work: 25,
            shortRest: 5,
            longRest: 15
        };
        let upcoming = "work";
        let transition = kind === "shortRest" ? "shortRestToWork" : "longRestToWork";
        if (kind === "work") {
            const longRest = number % every === 0;
            upcoming = longRest ? "longRest" : "shortRest";
            transition = longRest ? "workToLongRest" : "workToShortRest";
        }
        return {
            work_minutes: 25,
            short_rest_minutes: 5,
            long_rest_minutes: 15,
            long_rest_every: every,
            phase: {
                kind: kind,
                start: fixture.clockIso(startOffset),
                completed: kind === "work" ? number - 1 : number,
                planned_end: fixture.clockIso(startOffset + lengths[kind] * 60)
            },
            upcoming_phase: upcoming,
            transition: transition,
            number: number,
            entry_id: 20 + number,
            pomodoro_start: fixture.clockIso(startOffset)
        };
    }

    // The open pomodoro of a session, which is the running entry.
    function pomodoroEntry(session) {
        return entry(session.entry_id, 7, null, false, {
            start: session.pomodoro_start
        });
    }

    // Answers the newest state read with a session in the given phase.
    function answerSession(kind, startOffset, number, every) {
        const session = pomodoroSession(kind, startOffset, number, every);
        answerState(pomodoroEntry(session), null, session);
    }

    // A session's state as an action's reply.
    function sessionBody(kind, startOffset, number, every) {
        const session = pomodoroSession(kind, startOffset, number, every);
        return stateBody(pomodoroEntry(session), null, session);
    }

    // Configures the instance, validates the account and answers the first
    // state and project reads. current is the running entry, if any, and
    // pause or pomodoro the chain or the session the state holds.
    function connectAccount(url, user, workspace, current, projects, pause, pomodoro) {
        fixture.configure(url, "tok-" + user);
        answer("GET", "/me", 200, meBody(user, workspace));
        answerState(current === undefined ? null : current, pause, pomodoro);
        answer("GET", "/projects", 200, projects || [project(11, workspace, "Alpha", true), project(12, workspace, "Beta", false)]);
        tryCompare(button.timer, "status", TokklTimer.Ready);
    }

    // Offscreen, a closed menu window stays the focus window. Hand the focus
    // back to the test window, as the session does for the panel.
    function focusButton() {
        tryVerify(() => !button.menu.visible, 3000, "no menu open");
        testCase.Window.window.requestActivate();
        tryVerify(() => fixture.hasFocusWindow(button), 3000, "test window focused");
        button.forceActiveFocus(Qt.TabFocusReason);
        verify(button.activeFocus);
    }

    function openMenu() {
        focusButton();
        keyClick(Qt.Key_Menu);
        tryVerify(() => button.menu.opened, 3000, "menu opens");
    }

    function closeMenu() {
        button.menu.dismiss();
        tryVerify(() => !button.menu.visible, 3000, "menu closes");
    }

    // Highlights the given item of a menu with the arrow keys.
    function moveTo(menu, item) {
        for (let i = 0; i <= menu.count && menu.itemAt(menu.currentIndex) !== item; ++i) {
            keyClick(Qt.Key_Down);
        }
        compare(menu.itemAt(menu.currentIndex), item, "highlighted with the keyboard");
    }

    // Highlights the Project submenu's entry with the arrow keys.
    function moveToProject() {
        const menu = button.menu;
        for (let i = 0; i <= menu.count && menu.itemAt(menu.currentIndex).subMenu !== menu.projectMenu; ++i) {
            keyClick(Qt.Key_Down);
        }
        compare(menu.itemAt(menu.currentIndex).subMenu, menu.projectMenu, "Project highlighted with the keyboard");
    }

    function projectItem(name) {
        const menu = button.menu.projectMenu;
        for (let i = 0; i < menu.count; ++i) {
            const item = menu.itemAt(i);
            if (item && item.text === name) {
                return item;
            }
        }
        return null;
    }

    function chooseProjectWithKeyboard(name) {
        openMenu();
        moveToProject();
        keyClick(Qt.Key_Right);
        tryVerify(() => button.menu.projectMenu.opened, 3000, "Project opens");
        moveTo(button.menu.projectMenu, projectItem(name));
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after a choice");
    }

    function toggleBillableWithKeyboard() {
        openMenu();
        moveTo(button.menu, button.menu.billableItem);
        keyClick(Qt.Key_Space);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after a choice");
    }

    function init() {
        revision = 0;
        fixture = fixtureComponent.createObject(testCase);
        button = buttonComponent.createObject(testCase, {
            timer: fixture.timer,
            session: fixture.session
        });
        verify(button);
        button.width = button.implicitWidth;
        button.height = testCase.height;
        openSpy.target = button;
        configureSpy.target = button;
        openSpy.clear();
        configureSpy.clear();
    }

    // The panel item goes first: its bindings read the fixture's timer.
    function cleanup() {
        if (longDurationBefore >= 0) {
            fixture.setLongDuration(longDurationBefore);
            longDurationBefore = -1;
        }
        button.menu.dismiss();
        button.destroy();
        wait(0);
        fixture.destroy();
        wait(0);
    }

    // ----- panel ---------------------------------------------------------

    function test_showsTimeAndRunningState() {
        connectAccount(instanceA, 3, 7, entry(5, 7, null, false));
        verify(button.implicitWidth > 0);
        const label = findChild(button, "elapsedLabel");
        compare(label.text, "0:01");
        verify(label.visible);
        compare(button.words.runText, "Running");
        compare(button.Accessible.name, "Pause the Tokkl timer");
        verify(button.Accessible.description.indexOf("Running 0:01") === 0, button.Accessible.description);

        // Whole minutes: the label changes when the next minute starts.
        for (let i = 0; i < 54; ++i)
            fixture.advance(1000);
        compare(label.text, "0:01");
        fixture.advance(1000);
        compare(label.text, "0:02");
    }

    // A running entry as the server stores it once stopped: the seconds it
    // ran, and the fields a resume copies.
    function stoppedEntry(id, projectId, billable, seconds) {
        return entry(id, 7, projectId, billable, {
            start: fixture.clockIso(-seconds),
            stop: fixture.clockIso(),
            duration: seconds
        });
    }

    function checkWords(runText, name) {
        compare(button.words.runText, runText);
        compare(button.Accessible.name, name);
        verify(button.Accessible.description.indexOf(runText + " " + button.timer.elapsedText) === 0, button.Accessible.description);
        compare(button.menu.stateItem.text, runText + " " + button.timer.elapsedText + " · Connected");
    }

    function test_clickPausesSpaceResumesAndMenuStops() {
        connectAccount(instanceA, 3, 7);
        const label = findChild(button, "elapsedLabel");
        checkWords("Stopped", "Start the Tokkl timer");
        compare(button.menu.runItem.text, "Start");
        verify(button.menu.runItem.enabled);
        verify(button.timer.chooseProject(11));

        // A click starts.
        mouseClick(button, 5, 5, Qt.LeftButton);
        const start = waitFor("POST", "/workspaces/7/time_entries");
        const body = fixture.request(start).body;
        compare(body.project_id, 11);
        compare(body.billable, true, "Alpha's billable default");
        compare(button.timer.status, TokklTimer.Busy);
        compare(button.words.statusText, "Saving");
        const running = entry(9, 7, 11, true, {
            start: fixture.clockIso()
        });
        fixture.respond(start, 200, JSON.stringify(running));
        answerState(running);
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.running);
        fixture.advance(125000);
        compare(label.text, "0:02");
        checkWords("Running", "Pause the Tokkl timer");
        compare(button.menu.runItem.text, "Stop");
        verify(indicator().round);
        verify(indicator().pulsing);

        // A click pauses: the server stops the entry and keeps its time.
        mouseClick(button, 5, 5, Qt.LeftButton);
        const pause = waitFor("POST", "/timer/pause");
        compare(fixture.request(pause).body, {}, "a pause names no revision");
        fixture.respond(pause, 200, stateBody(null, pauseChain(true, 125, undefined, 11, true)));
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.paused);
        verify(!button.timer.running);
        checkWords("Paused", "Resume the Tokkl timer");
        verify(button.words.summary.indexOf("Paused 0:02 · Alpha") === 0, button.words.summary);
        compare(button.menu.runItem.text, "Stop");
        verify(button.menu.runItem.enabled);
        verify(!button.menu.projectMenu.enabled, "the paused entry's project stays");
        verify(!button.menu.billableItem.enabled, "the paused entry's billable flag stays");
        verify(button.menu.billableItem.checked);
        compare(button.menu.projectMenu.title, "Project: Alpha");
        verify(indicator().round, "a dot while paused");
        verify(!indicator().pulsing, "a still dot");
        compare(indicator().fillOpacity, 1);
        compare(indicator().fillColor, Qt.color("#06aaf5"));
        fixture.advance(120000);
        compare(label.text, "0:02", "frozen while paused");

        // Space resumes: the server starts a clone of the paused entry, against
        // the revision shown.
        button.forceActiveFocus(Qt.TabFocusReason);
        keyClick(Qt.Key_Space);
        const resume = waitFor("POST", "/timer/resume");
        compare(fixture.request(resume).body, {
            revision: revision
        });
        const resumed = entry(10, 7, 11, true, {
            start: fixture.clockIso()
        });
        fixture.respond(resume, 200, stateBody(resumed, pauseChain(false, 125, 10, 11, true)));
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.running);
        verify(!button.timer.paused);
        compare(label.text, "0:02", "counts on from the paused total");
        fixture.advance(55000);
        compare(label.text, "0:03");
        checkWords("Running", "Pause the Tokkl timer");
        verify(indicator().pulsing);

        // Stop in the menu ends the chain.
        openMenu();
        compare(button.menu.itemAt(button.menu.currentIndex), button.menu.runItem, "Stop is highlighted first");
        compare(button.menu.runItem.text, "Stop");
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after Stop");
        fixture.respond(waitFor("PATCH", "/time_entries/10/stop"), 200, JSON.stringify(stoppedEntry(10, 11, true, 55)));
        answerState(null);
        tryCompare(button.timer, "canWrite", true);
        verify(!button.timer.running);
        verify(!button.timer.paused);
        compare(label.text, "0:00");
        checkWords("Stopped", "Start the Tokkl timer");
        compare(button.menu.runItem.text, "Start");
        verify(!indicator().round, "a square while stopped");

        // The next click starts a new entry from 0:00.
        mouseClick(button, 5, 5, Qt.LeftButton);
        const next = waitFor("POST", "/workspaces/7/time_entries");
        verify(next > resume);
        compare(fixture.request(next).body.description, "", "a new entry, not a clone");
        const fresh = entry(11, 7, 11, true, {
            start: fixture.clockIso()
        });
        fixture.respond(next, 200, JSON.stringify(fresh));
        answerState(fresh);
        tryCompare(button.timer, "running", true);
        compare(label.text, "0:00");
    }

    function test_stopWhilePausedDiscardsTheChainOnTheServer() {
        connectAccount(instanceA, 3, 7, null, undefined, pauseChain(true, 65, undefined, 12, false));
        verify(button.timer.paused);
        const before = fixture.requestCount;

        openMenu();
        compare(button.menu.itemAt(button.menu.currentIndex), button.menu.runItem);
        compare(button.menu.runItem.text, "Stop");
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after Stop");
        const discard = waitFor("POST", "/timer/discard");
        compare(fixture.request(discard).body, {
            revision: revision
        }, "against the revision shown");
        compare(fixture.requestCount, before + 1, "nothing else is sent");
        compare(button.timer.status, TokklTimer.Busy);
        verify(button.timer.paused, "the chain stays until the server answers");

        fixture.respond(discard, 200, stateBody(null, null));
        tryCompare(button.timer, "canWrite", true);
        verify(!button.timer.paused);
        compare(findChild(button, "elapsedLabel").text, "0:00");
        checkWords("Stopped", "Start the Tokkl timer");
        verify(button.menu.projectMenu.enabled, "Project is a choice again");
        verify(button.menu.billableItem.enabled);
    }

    function test_stopWhilePausedWithoutTheServerKeepsTheChain() {
        connectAccount(instanceA, 3, 7, null, undefined, pauseChain(true, 65, undefined, 12, false));
        fixture.advance(31000);
        fixture.failNetwork(waitFor("GET", "/app/timer"));
        tryCompare(button.timer, "status", TokklTimer.Stale);

        // The discard is the server's, so the chain stays until it answers.
        openMenu();
        verify(button.menu.runItem.enabled);
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after Stop");
        fixture.failNetwork(waitFor("POST", "/timer/discard"));
        tryCompare(button.timer, "errorString", "Could not reach the Tokkl instance: unreachable");
        verify(button.timer.paused, "the chain stays");
        compare(findChild(button, "elapsedLabel").text, "0:01");
        compare(button.timer.status, TokklTimer.Busy, "the outcome is not known until a read settles it");
        verify(!button.timer.stop(), "the discard is not sent again");
        compare(fixture.pending("POST", "/timer/discard"), -1);

        // The server never got it: the read shows the chain, and Stop works again.
        answerState(null, pauseChain(true, 65, undefined, 12, false));
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.paused);
        verify(button.menu.runItem.available);
    }

    function test_aConflictOnATimerActionTellsTheUser() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 12, false));
        mouseClick(button, 5, 5, Qt.LeftButton);

        // The web app paused it first: the server answers with its own state.
        fixture.respond(waitFor("POST", "/timer/pause"), 409, stateBody(null, pauseChain(true, 65, undefined, 12, false)));
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.paused, "the state that refused it shows");
        compare(button.timer.status, TokklTimer.Error);
        compare(button.timer.errorString, "The timer changed on another device first.");
        compare(button.words.statusText, "Error");
        compare(button.words.detailText, "The timer changed on another device first.");
        verify(button.words.summary.indexOf("The timer changed on another device first.") >= 0, button.words.summary);
        verify(button.Accessible.description.indexOf("The timer changed on another device first.") >= 0, button.Accessible.description);
    }

    function test_keyboardFocusIsVisible() {
        connectAccount(instanceA, 3, 7);
        const frame = findChild(button, "focusFrame");
        verify(!button.activeFocus);
        verify(!frame.visible);
        button.forceActiveFocus(Qt.TabFocusReason);
        verify(button.activeFocus);
        verify(frame.visible, "the focus frame shows");
        verify(button.activeFocusOnTab);
        compare(button.Accessible.role, Accessible.Button);
    }

    // ----- menu ----------------------------------------------------------

    function test_menuIsKeyboardAccessible() {
        connectAccount(instanceA, 3, 7);
        openMenu();
        const menu = button.menu;
        compare(menu.itemAt(menu.currentIndex), menu.runItem, "Start is highlighted first");
        compare(menu.runItem.text, "Start");
        compare(menu.projectMenu.title, "Project: No project");
        verify(!menu.stateItem.enabled, "the state line is not a choice");
        compare(menu.stateItem.text, "Stopped 0:00 · Connected");

        // Every action is reachable with the arrow keys and has a label.
        const labels = [];
        for (let i = 0; i < menu.count + 1; ++i) {
            const item = menu.itemAt(menu.currentIndex);
            if (labels.indexOf(item.text) < 0) {
                labels.push(item.text);
            }
            keyClick(Qt.Key_Down);
        }
        verify(labels.indexOf("Start") >= 0, labels);
        verify(labels.indexOf("Project: No project") >= 0, labels);
        verify(labels.indexOf("Billable") >= 0, labels);
        verify(labels.indexOf("Reconnect") >= 0, labels);
        verify(labels.indexOf("Open Tokkl") >= 0, labels);
        verify(labels.indexOf("Configure Tokkl…") >= 0, labels);
        verify(labels.indexOf("Pomodoro mode") >= 0, labels);
        verify(labels.indexOf("Start session") < 0, "no session items in Timer mode: " + labels);

        keyClick(Qt.Key_Escape);
        tryVerify(() => !menu.visible, 3000, "Escape closes");

        focusButton();
        keyClick(Qt.Key_F10, Qt.ShiftModifier);
        tryVerify(() => menu.opened, 3000, "Shift+F10 opens");
        closeMenu();

        mouseClick(button, 5, 5, Qt.RightButton);
        tryVerify(() => menu.opened, 3000, "right click opens");
        closeMenu();
        compare(fixture.pending("POST", "/time_entries"), -1, "opening the menu starts nothing");
    }

    function test_openTokklAndConfigure() {
        connectAccount(instanceA, 3, 7);
        openMenu();
        moveTo(button.menu, button.menu.openItem);
        keyClick(Qt.Key_Return);
        tryCompare(openSpy, "count", 1);
        const url = openSpy.signalArguments[0][0].toString();
        compare(url, "https://a.example.test/tokkl/");
        verify(url.indexOf("@") < 0 && url.indexOf("tok-") < 0, "no credentials in the address");

        openMenu();
        moveTo(button.menu, button.menu.configureItem);
        keyClick(Qt.Key_Return);
        tryCompare(configureSpy, "count", 1);
    }

    function test_initialChoicesAndBillingDefaults() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        const menu = button.menu;
        verify(menu.noProjectItem.checked, "No project at first");
        verify(!menu.billableItem.checked, "nonbillable at first");

        chooseProjectWithKeyboard("Alpha");
        compare(button.timer.chosenProjectId, 11);
        verify(menu.billableItem.checked, "Alpha's billable default");
        verify(projectItem("Alpha").checked);
        verify(!menu.noProjectItem.checked);

        toggleBillableWithKeyboard();
        verify(!menu.billableItem.checked, "the checkbox overrides the default");
        compare(button.timer.chosenProjectId, 11, "the project stays");

        chooseProjectWithKeyboard("Beta");
        verify(!menu.billableItem.checked, "Beta is nonbillable");
        toggleBillableWithKeyboard();
        verify(menu.billableItem.checked);

        chooseProjectWithKeyboard("No project");
        compare(button.timer.chosenProjectId, null);
        verify(!menu.billableItem.checked, "No project is nonbillable");

        // The next start sends what was chosen.
        chooseProjectWithKeyboard("Alpha");
        toggleBillableWithKeyboard();
        mouseClick(button, 5, 5, Qt.LeftButton);
        const body = fixture.request(waitFor("POST", "/workspaces/7/time_entries")).body;
        compare(body.project_id, 11);
        compare(body.billable, false);
        compare(fixture.pending("PUT", "/time_entries/5"), -1, "no edit while stopped");
    }

    // A stopped entry of the last 9 days, as GET /me/time_entries?meta=true
    // lists it.
    function listedEntry(id, projectId, active, billable) {
        return entry(id, 7, projectId, billable, {
            stop: fixture.clockIso(-3600),
            duration: 600,
            project_active: active,
            project_billable: projectId === null ? null : billable
        });
    }

    function test_nextStartDefaultsToTheLastEntry() {
        // Nothing runs at connect: the newest listed entry's project.
        connectAccount(instanceA, 3, 7);
        const list = waitFor("GET", "/me/time_entries");
        compare(fixture.request(list).query.meta, "true");
        compare(Object.keys(fixture.request(list).query), ["meta"], "no date range: the API's last 9 days");
        fixture.respond(list, 200, JSON.stringify([listedEntry(8, 11, true, true), listedEntry(6, 12, true, false)]));
        tryCompare(button.timer, "chosenProjectId", 11);
        const menu = button.menu;
        compare(menu.projectMenu.title, "Project: Alpha");
        verify(projectItem("Alpha").checked);
        verify(!menu.noProjectItem.checked);
        verify(menu.billableItem.checked, "Alpha's billable default");

        mouseClick(button, 5, 5, Qt.LeftButton);
        const start = waitFor("POST", "/workspaces/7/time_entries");
        compare(fixture.request(start).body.project_id, 11);
        compare(fixture.request(start).body.billable, true);
    }

    function test_stopFromThePanelKeepsItsProject() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 12, false));
        compare(fixture.pending("GET", "/me/time_entries"), -1, "nothing to ask while an entry runs");

        // Stop in the menu ends the entry; a click would pause it.
        verify(button.timer.stop());
        fixture.respond(waitFor("PATCH", "/time_entries/5/stop"), 200, JSON.stringify(entry(5, 7, 12, false, {
            stop: fixture.clockIso(),
            duration: 65
        })));
        answerState(null);
        tryCompare(button.timer, "canWrite", true);
        verify(!button.timer.running);
        verify(!button.timer.paused);
        compare(button.timer.chosenProjectId, 12, "the stopped entry's project");
        const menu = button.menu;
        compare(menu.projectMenu.title, "Project: Beta");
        verify(projectItem("Beta").checked);
        verify(!menu.billableItem.checked, "Beta is nonbillable");
        compare(fixture.pending("GET", "/me/time_entries"), -1, "a stop needs no list");

        mouseClick(button, 5, 5, Qt.LeftButton);
        const start = waitFor("POST", "/workspaces/7/time_entries");
        compare(fixture.request(start).body.project_id, 12);
        compare(fixture.request(start).body.billable, false);
    }

    function test_projectsFollowPagination() {
        const firstPage = [];
        for (let i = 1; i <= 200; ++i) {
            firstPage.push(project(100 + i, 7, "Project " + i, false));
        }
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answerState(null);
        const first = answer("GET", "/projects", 200, firstPage);
        compare(fixture.request(first).query.page, "1");
        compare(fixture.request(first).query.per_page, "200");
        compare(fixture.request(first).query.active, "true");
        const second = answer("GET", "/projects", 200, [project(901, 7, "Last page", true)]);
        compare(fixture.request(second).query.page, "2");

        tryVerify(() => button.timer.projects.length === 201, 3000, "every page read");
        const menu = button.menu.projectMenu;
        tryCompare(menu, "count", 202, 3000, "No project and every active project");
        verify(projectItem("Project 1"));
        verify(projectItem("Project 200"));
        verify(projectItem("Last page"));

        chooseProjectWithKeyboard("Last page");
        compare(button.timer.chosenProjectId, 901);
        verify(button.menu.billableItem.checked);
    }

    // The notice in the Project submenu, or null.
    function incompleteNotice() {
        const menu = button.menu.projectMenu;
        for (let i = 0; i < menu.count; ++i) {
            const item = menu.itemAt(i);
            if (item && item.text.indexOf("cut short") >= 0) {
                return item;
            }
        }
        return null;
    }

    function test_incompleteProjectListShowsANotice() {
        // A complete list has no notice.
        connectAccount(instanceA, 3, 7);
        compare(button.timer.projectsIncomplete, false);
        verify(incompleteNotice() === null, "no notice for a complete list");

        // Every page up to the limit is full of new projects, so the list is
        // cut short. The menu only offers the discovered workspace's projects,
        // so all but three of them belong to another workspace; this keeps a
        // menu of 20,000 items out of the test.
        fixture.configure(instanceB, "tok-4");
        tryVerify(() => button.timer.projects.length === 0, 3000, "the first account's projects are gone");
        compare(button.timer.projectsIncomplete, false);
        answer("GET", "/me", 200, meBody(4, 7));
        answerState(null);
        for (let page = 1; page <= 100; ++page) {
            const projects = [];
            for (let i = 1; i <= 200; ++i) {
                const id = (page - 1) * 200 + i;
                projects.push(project(id, page === 1 && i <= 3 ? 7 : 9, "P" + id, false));
            }
            answer("GET", "/projects", 200, projects);
        }
        tryCompare(button.timer, "projectsIncomplete", true, 3000);
        compare(button.timer.projects.length, 3, "the projects of the workspace");
        const menu = button.menu.projectMenu;
        tryCompare(menu, "count", 5, 3000, "No project, the notice and the three projects");
        const notice = incompleteNotice();
        verify(notice !== null, "the notice is in the Project submenu");
        verify(!notice.enabled, "the notice cannot be chosen");
        verify(notice.Accessible.description.length > 0, "a screen reader gets the explanation");
        compare(menu.itemAt(1), notice, "the notice comes before the projects");
        verify(projectItem("P1"), "the projects read stay selectable");
        verify(projectItem("P3"));

        // Switching account clears the notice with the projects.
        fixture.configure(instanceA, "tok-3");
        tryCompare(button.timer, "projectsIncomplete", false, 3000);
        tryCompare(menu, "count", 1, 3000);
        verify(incompleteNotice() === null, "no notice after the switch");
    }

    function test_archivedCurrentProjectIsShownNotOffered() {
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answerState(entry(5, 7, 33, true));
        answer("GET", "/projects", 200, [project(11, 7, "Alpha", true)]);
        answer("GET", "/projects/33", 200, project(33, 7, "Legacy", true, false));
        tryCompare(button.words, "projectText", "Legacy (archived)");

        const menu = button.menu.projectMenu;
        compare(menu.title, "Project: Legacy (archived)");
        tryCompare(menu, "count", 3, 3000, "No project, the archived one and Alpha");
        const archived = projectItem("Legacy (archived)");
        verify(archived);
        verify(archived.checked, "marked as the entry's project");
        verify(!archived.enabled, "not a choice");
        verify(!button.timer.chooseProject(33), "an archived project is refused");
        compare(fixture.pending("PUT", "/time_entries/5"), -1);
        verify(button.timer.projects.every(p => p.id !== 33), "not among the active projects");
        verify(!projectItem("Alpha").enabled, "the running entry's project is locked");
        verify(!button.timer.chooseProject(11), "no move to an active project while running");
        compare(fixture.pending("PUT", "/time_entries/5"), -1);
    }

    function test_projectIsLockedWhileRunning() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 12, false));
        const before = fixture.requestCount;
        const menu = button.menu;
        compare(menu.projectMenu.title, "Project: Beta", "the title names the running entry's project");
        verify(!menu.projectMenu.enabled, "Project is locked while an entry runs");
        verify(!menu.noProjectItem.enabled);
        verify(!projectItem("Alpha").enabled);
        verify(!projectItem("Beta").enabled);
        verify(projectItem("Beta").checked);
        verify(menu.billableItem.enabled, "Billable stays editable");

        verify(!button.timer.chooseProject(11), "a direct call is refused too");
        verify(!button.timer.chooseProject(null));
        compare(fixture.pending("PUT", "/time_entries/5"), -1, "no edit sent");
        compare(button.timer.chosenProjectId, 12);

        // Billable edits the running entry with billable alone.
        toggleBillableWithKeyboard();
        const put = waitFor("PUT", "/workspaces/7/time_entries/5");
        compare(fixture.request(put).body, {
            billable: true
        }, "a billable change sends only billable");
        compare(button.timer.status, TokklTimer.Busy);

        // The server keeps everything else; the same entry keeps running.
        fixture.respond(put, 200, JSON.stringify(entry(5, 7, 12, true)));
        answerState(entry(5, 7, 12, true));
        tryCompare(button.timer, "canWrite", true);
        const current = button.timer.currentEntry;
        compare(current.id, 5);
        compare(current.description, "Write the report");
        compare(current.tags, ["deep work", "q4"]);
        verify(current.running);
        compare(button.timer.elapsedSeconds, 65, "not split: the start is unchanged");
        verify(menu.billableItem.checked);
        verify(!menu.projectMenu.enabled, "still locked after the edit");
        for (let i = before; i < fixture.requestCount; ++i) {
            const request = fixture.request(i);
            verify(request.method === "GET" || request.method === "PUT", request.method + " " + request.path);
        }

        // Stopped, Project is a choice again. A click would pause, which
        // keeps the project.
        verify(button.timer.stop());
        fixture.respond(waitFor("PATCH", "/time_entries/5/stop"), 200, JSON.stringify(entry(5, 7, 12, true, {
            stop: fixture.clockIso(),
            duration: 65
        })));
        answerState(null);
        tryCompare(button.timer, "canWrite", true);
        verify(!button.timer.running);
        verify(menu.projectMenu.enabled);
        verify(menu.noProjectItem.enabled);
        verify(projectItem("Alpha").enabled);
        verify(projectItem("Beta").enabled);
        verify(button.timer.chooseProject(11));
        compare(button.timer.chosenProjectId, 11);
        compare(fixture.pending("PUT", "/time_entries/5"), -1, "a stopped choice sends nothing");
    }

    // ----- states and disabled controls -----------------------------------

    function test_unconfiguredDisablesEverything() {
        compare(button.timer.status, TokklTimer.Unconfigured);
        compare(button.words.statusText, "Not configured");
        verify(button.words.detailText.length > 0);
        openMenu();
        const menu = button.menu;
        verify(!menu.runItem.enabled, "nothing to start");
        verify(!menu.projectMenu.enabled);
        verify(!menu.billableItem.enabled);
        verify(!menu.openItem.enabled, "no address to open");
        verify(!menu.reconnectItem.enabled);
        verify(menu.configureItem.enabled);
        verify(menu.modeItem.enabled, "the mode belongs to the device, not the account");
        compare(menu.itemAt(menu.currentIndex), menu.modeItem, "focus starts on the first enabled entry");
        closeMenu();

        mouseClick(button, 5, 5, Qt.LeftButton);
        verify(!button.timer.chooseProject(null));
        verify(!button.timer.chooseBillable(true));
        compare(fixture.requestCount, 0, "nothing was sent");
    }

    function test_statesAreDistinguishableWithoutColor() {
        const seen = {};
        function record(status) {
            tryCompare(button.timer, "status", status);
            const text = button.words.statusText;
            verify(!(text in seen), "own text for " + text);
            seen[text] = findChild(button, "stateIcon").source.toString();
            compare(button.Accessible.description.indexOf(text) >= 0, true, button.Accessible.description);
        }

        record(TokklTimer.Unconfigured);
        fixture.configure(instanceA, "tok-3");
        record(TokklTimer.Loading);
        answer("GET", "/me", 200, meBody(3, 7));
        answer("GET", "/projects", 200, [project(11, 7, "Alpha", true)]);
        compare(button.timer.status, TokklTimer.Loading, "until the current entry is known");
        verify(!button.timer.canWrite);
        answerState(null);
        record(TokklTimer.Ready);
        verify(!findChild(button, "stateIcon").visible, "no state symbol when ready");

        mouseClick(button, 5, 5, Qt.LeftButton);
        record(TokklTimer.Busy);
        verify(!button.menu.billableItem.enabled);
        fixture.respond(waitFor("POST", "/time_entries"), 200, JSON.stringify(entry(9, 7, null, false)));
        answerState(entry(9, 7, null, false));
        tryCompare(button.timer, "status", TokklTimer.Ready);

        fixture.advance(31000);
        fixture.failNetwork(waitFor("GET", "/app/timer"));
        record(TokklTimer.Stale);
        verify(button.timer.running, "the last known entry stays");

        fixture.advance(31000);
        answer("GET", "/app/timer", 401, JSON.stringify("Invalid credentials"));
        record(TokklTimer.AuthenticationBlocked);
        verify(!button.timer.canWrite);
        verify(!button.menu.projectMenu.enabled);
        verify(!button.menu.billableItem.enabled);
        verify(button.menu.reconnectItem.enabled, "Reconnect stays available");

        fixture.configure("https://user:secret@a.example.test", "tok-3");
        record(TokklTimer.Error);
        verify(!button.menu.openItem.enabled, "an address with user info is never opened");

        // Seven states with seven texts; the six that are not ready also
        // have a symbol each.
        compare(Object.keys(seen).length, 7);
        delete seen["Connected"];
        compare(new Set(Object.values(seen)).size, 6);
    }

    // ----- project indicator -----------------------------------------------

    function colored(id, name, color, active) {
        return Object.assign(project(id, 7, name, false, active), {
            color: color
        });
    }

    // The WCAG 2 contrast ratio of two colours.
    function contrast(a, b) {
        function channel(c) {
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }
        function luminance(c) {
            return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
        }
        const la = luminance(a);
        const lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    function indicator() {
        return findChild(button, "projectIndicator");
    }

    // The colour of the panel item at a point of the indicator's shape.
    function shapePixel(x, y) {
        const shape = findChild(button, "indicatorShape");
        const point = shape.mapToItem(button, x, y);
        return grabImage(button).pixel(Math.floor(point.x), Math.floor(point.y));
    }

    function test_monochromeLogoFollowsPanelForeground() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(button.timer.chooseProject(11));
        const logo = findChild(button, "logoIcon");
        compare(logo.isMask, false);
        const width = button.width;
        button.monochromeIcon = true;
        compare(logo.isMask, true);
        for (const ink of ["#ffffff", "#000000"]) {
            // Override only the panel item, independently of the application theme.
            button.Kirigami.Theme.textColor = ink;
            tryVerify(() => {
                const image = grabImage(button);
                const origin = logo.mapToItem(button, 0, 0);
                const target = ink === "#ffffff" ? 1 : 0;
                let matching = 0;
                for (let y = 0; y < logo.height; ++y) {
                    for (let x = 0; x < logo.width; ++x) {
                        const pixel = image.pixel(Math.floor(origin.x + x), Math.floor(origin.y + y));
                        if (Math.abs(pixel.r - pixel.g) > 0.02 || Math.abs(pixel.g - pixel.b) > 0.02) return false;
                        // Scaling the alpha edges can leave a few levels of background mixed in.
                        if (Math.abs(pixel.r - target) < 0.02) matching++;
                    }
                }
                return matching > 10;
            }, 3000, "the drawn logo follows the panel text colour");
            verify(Qt.colorEqual(indicator().fillColor, "#06aaf5"));
        }
        compare(button.width, width);
        button.monochromeIcon = false;
        compare(logo.isMask, false);
    }

    function test_indicatorSitsBetweenTheLogoAndTheTime() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const ind = indicator();
        const logo = findChild(button, "logoIcon");
        const label = findChild(button, "elapsedLabel");
        const left = ind.mapToItem(button, 0, 0).x;
        verify(logo.width > 0);
        verify(left >= logo.mapToItem(button, logo.width, 0).x, "right of the logo");
        verify(left + ind.width <= label.mapToItem(button, 0, 0).x, "left of the elapsed time");
        verify(ind.width > 0);
        verify(ind.Accessible.ignored, "decoration only; the words carry the project");
    }

    function test_runningProjectPulsesInItsColour() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const ind = indicator();
        verify(ind.filled);
        verify(!ind.dashed);
        verify(ind.round, "a dot while running");
        verify(Qt.colorEqual(ind.fillColor, "#06aaf5"), ind.fillColor);
        verify(ind.pulsing, "the dot pulses");
        tryVerify(() => ind.fillOpacity < 0.9, 3000, "its opacity moves");

        const fill = findChild(button, "indicatorFill");
        verify(fill.visible);
        compare(fill.radius, fill.width / 2);
        verify(fill.border.width >= 1, "a ring surrounds the fill");
        verify(Qt.colorEqual(fill.border.color, Kirigami.Theme.textColor), "the ring is in the text colour");
        verify(!findChild(button, "indicatorOutline").visible);

        verify(button.words.summary.indexOf("Alpha") >= 0, button.words.summary);
        verify(button.Accessible.description.indexOf("Running 0:01 · Alpha") === 0, button.Accessible.description);
    }

    function test_stoppedProjectIsAStillSquare() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(button.timer.chooseProject(11));
        const ind = indicator();
        verify(ind.filled);
        verify(!ind.round, "a square while stopped");
        verify(!ind.pulsing, "still");
        compare(ind.fillOpacity, 1);
        const fill = findChild(button, "indicatorFill");
        verify(fill.radius < fill.width / 2);
        verify(button.Accessible.description.indexOf("Stopped 0:00 · Alpha") === 0, button.Accessible.description);

        // Drawn: the project colour inside, the text colour on the ring.
        const shape = findChild(button, "indicatorShape");
        tryVerify(() => Qt.colorEqual(shapePixel(shape.width / 2, shape.height / 2), "#06aaf5"), 3000, "filled with the project colour");
        tryVerify(() => Qt.colorEqual(shapePixel(0, shape.height / 2), ind.ringColor), 3000, "ringed in the text colour");
        verify(Qt.colorEqual(ind.ringColor, Kirigami.Theme.textColor));
    }

    function test_noProjectIsADashedOutline() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        const ind = indicator();
        verify(ind.dashed, "a dashed square while stopped");
        verify(!ind.filled);
        verify(!ind.round);
        verify(!ind.pulsing);
        verify(findChild(button, "indicatorOutline").visible);
        verify(!findChild(button, "indicatorFill").visible);
        verify(button.Accessible.description.indexOf("Stopped 0:00 · No project") === 0, button.Accessible.description);
        const width = ind.width;

        // Drawn: inside its corners, the left side has dashes in the text
        // colour and gaps between them.
        const shape = findChild(button, "indicatorShape");
        function leftSide() {
            const image = grabImage(button);
            const origin = shape.mapToItem(button, 0, 0);
            const ink = [];
            for (let y = 1; y < shape.height - 1; ++y) {
                ink.push(Qt.colorEqual(image.pixel(Math.floor(origin.x), Math.floor(origin.y) + y), ind.ringColor));
            }
            return ink;
        }
        tryVerify(() => {
            const ink = leftSide();
            return ink.indexOf(true) >= 0 && ink.indexOf(false) >= 0;
        }, 3000, "a dashed side");

        mouseClick(button, 5, 5, Qt.LeftButton);
        fixture.respond(waitFor("POST", "/workspaces/7/time_entries"), 200, JSON.stringify(entry(9, 7, null, false)));
        answerState(entry(9, 7, null, false));
        tryCompare(button.timer, "running", true);
        verify(ind.dashed, "a dashed circle while running");
        verify(ind.round);
        compare(ind.width, width);
        verify(button.words.summary.indexOf("No project") >= 0, button.words.summary);
    }

    function test_pendingProjectLeavesTheSlotEmpty() {
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answerState(entry(5, 7, 33, true));
        answer("GET", "/projects", 200, [project(11, 7, "Alpha", true)]);
        tryCompare(button.timer, "indicatorState", TokklTimer.IndicatorState.Pending);
        const ind = indicator();
        verify(!ind.filled);
        verify(!ind.dashed);
        verify(!findChild(button, "indicatorFill").visible);
        verify(!findChild(button, "indicatorOutline").visible);
        verify(!ind.pulsing, "nothing to pulse");
        const width = ind.width;
        const rowWidth = button.implicitWidth;
        verify(width > 0, "the slot keeps its width");

        answer("GET", "/projects/33", 200, colored(33, "Legacy", "#9e5bd9", false));
        tryVerify(() => ind.filled, 3000, "filled once known");
        verify(Qt.colorEqual(ind.fillColor, "#9e5bd9"));
        compare(ind.width, width);
        compare(button.implicitWidth, rowWidth, "the row does not change size");
    }

    function test_invalidColourFallsBackToTheTextColour() {
        connectAccount(instanceA, 3, 7, undefined, [colored(11, "Alpha", "blue"), colored(12, "Beta", "#06aaf")]);
        answer("GET", "/me/time_entries", 200, []);
        const ind = indicator();
        for (const id of [11, 12]) {
            verify(button.timer.chooseProject(id));
            compare(button.timer.indicatorState, TokklTimer.IndicatorState.Project);
            verify(ind.filled, "a solid shape");
            verify(Qt.colorEqual(ind.fillColor, Kirigami.Theme.textColor), "in the text colour");
        }
    }

    function test_reducedMotionStopsThePulse() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const ind = indicator();
        verify(!ind.reducedMotion);
        verify(ind.pulsing);

        // Plasma's Animation speed at "Instant" gives longDuration 1.
        longDurationBefore = fixture.setLongDuration(1);
        verify(longDurationBefore > 1, "Kirigami.Units is reachable");
        verify(ind.reducedMotion);
        verify(!ind.pulsing, "no pulse");
        compare(ind.fillOpacity, 1, "steady at full opacity");
        fixture.advance(1000);
        wait(100);
        compare(ind.fillOpacity, 1);

        fixture.setLongDuration(0);
        verify(!ind.pulsing);

        fixture.setLongDuration(longDurationBefore);
        verify(ind.pulsing, "the pulse comes back with the setting");
    }

    function test_pulseFadesOnlyTheFill() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const ind = indicator();
        const shape = findChild(button, "indicatorShape");
        const fill = findChild(button, "indicatorFill");
        tryVerify(() => Math.min(shape.opacity, fill.opacity) < 0.45, 3000, "the pulse reaches its low point");
        compare(shape.opacity, 1, "the shape as a whole stays opaque");
        verify(fill.opacity < 0.45, "the fill fades");
        const ring = findChild(button, "indicatorRing");
        verify(ring, "the ring is drawn on its own");
        verify(ring.visible);
        compare(ring.opacity, 1, "the ring never fades");
        verify(ring.border.width >= 1);
        verify(Qt.colorEqual(ring.border.color, ind.ringColor));
        // As drawn, the ring's edge keeps 3:1 against the background next to it.
        const edge = shapePixel(0, shape.height / 2);
        const outside = shapePixel(-1, shape.height / 2);
        const ratio = contrast(edge, outside);
        verify(ratio >= 3, "ring " + edge + " on " + outside + ": " + ratio);
    }

    function test_dashedOutlineNeverFades() {
        connectAccount(instanceA, 3, 7, entry(5, 7, null, true));
        const ind = indicator();
        verify(ind.dashed);
        verify(ind.round);
        const shape = findChild(button, "indicatorShape");
        const outline = findChild(button, "indicatorOutline");
        // A whole pulse cycle is 1.6 s.
        for (let i = 0; i < 36; ++i) {
            compare(shape.opacity, 1, "the shape stays opaque");
            compare(outline.opacity, 1, "the outline stays opaque");
            wait(50);
        }
        verify(!ind.pulsing, "only a fill pulses");
    }

    function test_hiddenIndicatorStopsThePulse() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const ind = indicator();
        const fill = findChild(button, "indicatorFill");
        verify(ind.pulsing);

        ind.visible = false;
        verify(!ind.pulsing, "a hidden item does not pulse");
        compare(fill.opacity, 1, "the fill is back at full opacity");
        ind.visible = true;
        verify(ind.pulsing, "showing it again restarts the pulse");

        const window = button.Window.window;
        window.visible = false;
        try {
            verify(!ind.pulsing, "a hidden window does not pulse");
            compare(fill.opacity, 1);
        } finally {
            window.visible = true;
        }
        tryVerify(() => ind.pulsing, 3000, "the pulse restarts with the window");
    }

    // ----- accounts --------------------------------------------------------

    function test_switchingAccountsClearsChoices() {
        connectAccount(instanceA, 3, 7);
        chooseProjectWithKeyboard("Alpha");
        toggleBillableWithKeyboard();
        compare(button.timer.chosenProjectId, 11);
        verify(!button.timer.chosenBillable);

        // A read of the first account is still in flight at the switch.
        fixture.advance(31000);
        const lateRead = waitFor("GET", "/app/timer");

        openMenu();
        fixture.configure(instanceB, "tok-4");
        tryVerify(() => !button.menu.visible, 3000, "the menu closes with the old context");
        compare(button.timer.chosenProjectId, null, "back to No project");
        verify(!button.timer.chosenBillable, "back to nonbillable");
        compare(button.timer.projects.length, 0, "no project of the previous account");
        compare(button.menu.projectMenu.count, 1);
        compare(button.timer.status, TokklTimer.Loading);
        verify(!button.timer.chooseProject(11), "no choice before the new account is known");

        // The same ids in another account: only its own names show.
        connectAccount(instanceB, 4, 7, undefined, [project(11, 7, "Gamma", false)]);
        verify(button.menu.noProjectItem.checked);
        verify(!button.menu.billableItem.checked);
        verify(projectItem("Gamma"));
        verify(!projectItem("Alpha"));
        fixture.respond(lateRead, 200, stateBody(entry(77, 7, 11, true)));
        verify(!button.timer.running, "the first account's late answer is dropped");
        compare(button.timer.chosenProjectId, null);

        // Back to the first account: nothing is restored from before.
        fixture.configure(instanceA, "tok-3");
        compare(button.timer.chosenProjectId, null);
        connectAccount(instanceA, 3, 7);
        compare(button.timer.chosenProjectId, null, "no fallback to the earlier choice");
        verify(!button.timer.chosenBillable);
        verify(button.menu.noProjectItem.checked);
    }

    // ----- Pomodoro mode -----------------------------------------------------

    function preferences(work, shortRest, longRest, every) {
        return {
            pomodoro_focus_interval_in_minutes: work,
            pomodoro_break_interval_in_minutes: shortRest,
            pomodoro_long_break_interval_in_minutes: longRest,
            pomodoro_long_break_every: every
        };
    }

    function minutes(count) {
        return count * 60 * 1000;
    }

    function glyph() {
        return findChild(button, "pomodoroGlyph");
    }

    function checkGlyphFile(name) {
        const source = glyph().source.toString();
        verify(source.endsWith("/contents/images/" + name), source);
    }

    // A click in Pomodoro mode asks the server for a session, which answers
    // with the first work phase.
    function startSession(every) {
        mouseClick(button, 5, 5, Qt.LeftButton);
        const start = waitFor("POST", "/pomodoro");
        verify(!fixture.session.active, "the server starts it, not this device");
        fixture.respond(start, 200, sessionBody("work", 0, 1, every));
        tryVerify(() => fixture.session.active, 3000, "the session shows once the server answers");
        verify(!button.menu.visible, "starting a session opens no menu");
        return start;
    }

    // Opens the menu with the keyboard and checks the session items and the
    // mode item. Leaves it open.
    function checkSessionMenu(state) {
        openMenu();
        const menu = button.menu;
        compare(menu.runItem.visible, state.run, "Start or Stop");
        compare(menu.startSessionItem.visible, state.startSession, "Start session");
        compare(menu.nextPhaseItem.visible, state.nextPhase !== undefined, "Next phase");
        if (state.nextPhase !== undefined) {
            compare(menu.nextPhaseItem.text, state.nextPhase);
        }
        compare(menu.endSessionItem.visible, state.endSession, "End session");
        compare(menu.modeItem.checked, state.mode, "Pomodoro mode checked");
        compare(menu.modeItem.enabled, !state.locked, "Pomodoro mode enabled");
        compare(menu.modeItem.text, state.locked ? "Pomodoro mode (locked while running)" : "Pomodoro mode");
        verify(menu.itemAt(menu.currentIndex).visible, "the highlighted entry is shown");
        // Hidden entries take no room.
        let y = 0;
        for (let i = 0; i < menu.count; ++i) {
            const item = menu.itemAt(i);
            if (item.visible) {
                compare(item.y, y, "no gap before " + item.text);
                y += item.height;
            }
        }
        return menu;
    }

    function test_timerModeLocksTheModeWhileATimerRuns() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 11, true));
        const session = fixture.session;
        verify(!session.pomodoroMode);
        verify(!glyph().visible, "no hourglass in Timer mode");
        compare(findChild(button, "elapsedLabel").text, "0:01");
        compare(button.Accessible.name, "Pause the Tokkl timer");
        verify(button.words.summary.indexOf("Pomodoro") < 0, button.words.summary);

        let menu = checkSessionMenu({
            run: true,
            startSession: false,
            endSession: false,
            mode: false,
            locked: true
        });
        compare(menu.runItem.text, "Stop");
        verify(!menu.messageItem.visible);
        closeMenu();
        verify(!session.setPomodoroMode(true), "refused while a timer runs");

        // Stopped, the mode is a choice again.
        verify(button.timer.stop());
        fixture.respond(waitFor("PATCH", "/time_entries/5/stop"), 200, JSON.stringify(stoppedEntry(5, 11, true, 65)));
        answerState(null);
        tryCompare(button.timer, "canWrite", true);
        menu = checkSessionMenu({
            run: true,
            startSession: false,
            endSession: false,
            mode: false,
            locked: false
        });
        compare(menu.runItem.text, "Start");
        compare(menu.itemAt(menu.currentIndex), menu.runItem, "Start is still highlighted first");
        closeMenu();
    }

    function test_pomodoroModeWithoutASession() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(button.timer.chooseProject(11));
        const menu = button.menu;
        const logo = findChild(button, "logoIcon");
        verify(!glyph().visible);

        // Turned on from the menu with the keyboard.
        openMenu();
        moveTo(menu, menu.modeItem);
        keyClick(Qt.Key_Space);
        tryVerify(() => !menu.visible, 3000, "menu closes after a choice");
        verify(fixture.session.pomodoroMode);

        // The colour hourglass right of the logo; the indicator and the
        // time keep their order after it.
        verify(glyph().visible);
        verify(!glyph().isMask);
        const left = glyph().mapToItem(button, 0, 0).x;
        verify(left >= logo.mapToItem(button, logo.width, 0).x, "right of the logo");
        verify(left + glyph().width <= indicator().mapToItem(button, 0, 0).x, "left of the project indicator");
        verify(glyph().width > 0 && glyph().width <= logo.width);
        checkGlyphFile("hourglass.svg");
        compare(findChild(button, "elapsedLabel").text, "0:00", "the time as in Timer mode");
        compare(button.words.summary, "Stopped 0:00 · Alpha · Connected · Pomodoro mode");
        compare(button.Accessible.name, "Start a Pomodoro session · Pomodoro mode");

        checkSessionMenu({
            run: false,
            startSession: true,
            endSession: false,
            mode: true,
            locked: false
        });
        verify(menu.startSessionItem.enabled);
        compare(menu.itemAt(menu.currentIndex), menu.startSessionItem, "Start session is highlighted first");
        verify(menu.projectMenu.enabled);
        verify(menu.billableItem.enabled);
        closeMenu();

        // Monochrome: the single-colour hourglass, tinted with the panel
        // text colour as the logo is.
        button.monochromeIcon = true;
        verify(glyph().isMask);
        checkGlyphFile("hourglass-mono.svg");
        for (const ink of ["#ffffff", "#000000"]) {
            button.Kirigami.Theme.textColor = ink;
            verify(Qt.colorEqual(glyph().color, ink), "tinted with " + ink);
            verify(Qt.colorEqual(glyph().color, findChild(button, "logoIcon").color), "as the logo");
        }
        button.monochromeIcon = false;
        verify(!glyph().isMask);
        checkGlyphFile("hourglass.svg");

        // Off again: the panel is the Timer mode's.
        openMenu();
        moveTo(menu, menu.modeItem);
        keyClick(Qt.Key_Space);
        tryVerify(() => !menu.visible, 3000, "menu closes after a choice");
        verify(!fixture.session.pomodoroMode);
        verify(!glyph().visible);
        compare(button.words.summary, "Stopped 0:00 · Alpha · Connected");
        compare(button.Accessible.name, "Start the Tokkl timer");
    }

    // The drawn hourglass: how many of its pixels have each of the colours,
    // and how many are not a shade of grey.
    function glyphPixels(colors) {
        const image = grabImage(button);
        const item = glyph();
        const origin = item.mapToItem(button, 0, 0);
        const drawn = {
            counts: colors.map(() => 0),
            notGrey: 0
        };
        for (let y = 0; y < item.height; ++y) {
            for (let x = 0; x < item.width; ++x) {
                const pixel = image.pixel(Math.floor(origin.x + x), Math.floor(origin.y + y));
                colors.forEach((color, i) => {
                    if (Qt.colorEqual(pixel, color)) {
                        drawn.counts[i]++;
                    }
                });
                if (Math.abs(pixel.r - pixel.g) > 0.02 || Math.abs(pixel.g - pixel.b) > 0.02) {
                    drawn.notGrey++;
                }
            }
        }
        return drawn;
    }

    function test_hourglassIsDrawnInColourAndMonochrome() {
        connectAccount(instanceA, 3, 7);
        verify(fixture.session.setPomodoroMode(true));
        tryVerify(() => glyph().visible && glyph().width > 0, 3000, "the hourglass is shown");

        // The colour file: a magenta frame around yellow sand. Of the 16 × 16
        // pixels, 40 are exactly the frame colour and about 24 exactly the
        // sand colour; the sand's slanted edges are blended.
        tryVerify(() => {
            const drawn = glyphPixels(["#f6209b", "#f7b817"]);
            return drawn.counts[0] >= 30 && drawn.counts[1] >= 15;
        }, 3000, "the colour hourglass is drawn");

        // Monochrome: the single-colour file, a black shape on the white
        // window. Black ink is the file's own colour. Kirigami 6.31 tints a
        // mask only in a shader, which the software renderer used here
        // does not run, so another ink would draw black there too.
        // test_pomodoroModeWithoutASession checks the tint the icon is given.
        button.monochromeIcon = true;
        button.Kirigami.Theme.textColor = "#000000";
        tryVerify(() => {
            const drawn = glyphPixels(["#000000", "#ffffff"]);
            return drawn.notGrey === 0 && drawn.counts[0] >= 40 && drawn.counts[1] >= 60;
        }, 3000, "the monochrome hourglass is drawn");
    }

    function cachedLengths(settings) {
        return [settings.cachedWorkMinutes, settings.cachedShortRestMinutes, settings.cachedLongRestMinutes, settings.cachedLongRestEvery];
    }

    function test_lengthsCacheKeepsTheAccountsLastKnownLengths() {
        const settings = createTemporaryObject(settingsComponent, testCase);
        verify(createTemporaryObject(lengthsCacheComponent, testCase, {
            configuration: settings,
            connection: fixture.connection,
            preferences: fixture.preferences
        }));
        // Without an account the preferences show the defaults, which must
        // not replace what an earlier run kept.
        wait(50);
        compare(cachedLengths(settings), [40, 8, 20, 3]);
        compare(settings.saves, 0);

        // Once the account is known, its lengths are kept and saved.
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/preferences", 200, preferences(50, 10, 30, 2));
        tryVerify(() => cachedLengths(settings).join() === "50,10,30,2", 3000, "the account's lengths are kept");
        verify(settings.saves > 0);

        // Apply on the settings page writes back the lengths the page opened
        // with. They are put right with one save, and nothing more follows.
        const saves = settings.saves;
        settings.cachedWorkMinutes = 40;
        settings.cachedLongRestEvery = 3;
        tryVerify(() => cachedLengths(settings).join() === "50,10,30,2", 3000, "the account's lengths are put back");
        compare(settings.saves, saves + 1);
        wait(50);
        compare(settings.saves, saves + 1);

        // Another account: until it is known, the last one's lengths stay.
        fixture.configure(instanceB, "tok-4");
        wait(50);
        compare(cachedLengths(settings), [50, 10, 30, 2]);
        compare(settings.saves, saves + 1);
    }

    function test_sessionCountsDownAndOpensTheMenu() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(fixture.session.setPomodoroMode(true));
        verify(button.timer.chooseProject(11));
        const menu = button.menu;
        const label = findChild(button, "elapsedLabel");

        const start = startSession(4);
        compare(fixture.request(start).body.project_id, 11, "the chosen project");
        compare(fixture.request(start).body.billable, true, "and Alpha's billable default");
        compare(fixture.pending("POST", "/time_entries"), -1, "a session starts no timer");
        compare(label.text, "25:00");
        fixture.advance(1000);
        compare(label.text, "24:59");
        verify(glyph().visible);
        compare(button.words.summary, "Work · 24:59 left · Pomodoro 1 of 4");
        compare(button.Accessible.name, "Work · 24:59 left · Pomodoro 1 of 4");
        verify(button.Accessible.description.indexOf("Alpha") >= 0, "the project stays in words: " + button.Accessible.description);

        // Mid-phase, a click opens the menu.
        mouseClick(button, 5, 5, Qt.LeftButton);
        tryVerify(() => menu.opened, 3000, "a click mid-phase opens the menu");
        compare(fixture.session.phase, "work", "and confirms nothing");
        compare(fixture.pending("POST", "/pomodoro/next"), -1);
        closeMenu();

        // So does Space, with the first entry highlighted.
        checkSessionMenu({
            run: false,
            startSession: false,
            nextPhase: "Next phase: Short rest",
            endSession: true,
            mode: true,
            locked: true
        });
        compare(menu.stateItem.text, "Work · 24:59 left · Pomodoro 1 of 4");
        compare(menu.itemAt(menu.currentIndex), menu.nextPhaseItem, "Next phase is highlighted first");
        verify(!menu.projectMenu.enabled, "Project cannot reach the open pomodoro");
        verify(!menu.billableItem.enabled, "neither can Billable");
        closeMenu();
        focusButton();
        keyClick(Qt.Key_Space);
        tryVerify(() => menu.opened, 3000, "Space mid-phase opens the menu");
        compare(menu.itemAt(menu.currentIndex), menu.nextPhaseItem);

        // End session: a pomodoro this short is not saved, and the menu says so.
        moveTo(menu, menu.endSessionItem);
        keyClick(Qt.Key_Return);
        tryVerify(() => !menu.visible, 3000, "menu closes after End session");
        const end = waitFor("POST", "/pomodoro/end");
        compare(fixture.request(end).body, {
            revision: revision
        }, "against the revision shown");
        verify(fixture.session.active, "the session ends when the server says so");
        fixture.respond(end, 200, stateBody(null, null, null, {
            entry_id: 21,
            start: fixture.clockIso(-1),
            stop: fixture.clockIso(-1)
        }));
        verify(!fixture.session.active);
        compare(label.text, "0:00", "the timer's time again");
        compare(button.words.summary, "Stopped 0:00 · Alpha · Connected · Pomodoro mode · This pomodoro was too short to save.");
        checkSessionMenu({
            run: false,
            startSession: true,
            endSession: false,
            mode: true,
            locked: false
        });
        verify(menu.messageItem.visible);
        verify(!menu.messageItem.enabled, "the message is not a choice");
        compare(menu.messageItem.text, "This pomodoro was too short to save.");
        compare(menu.itemAt(menu.currentIndex), menu.startSessionItem);

        // Start session from the menu clears it.
        keyClick(Qt.Key_Return);
        tryVerify(() => !menu.visible, 3000, "menu closes after Start session");
        fixture.respond(waitFor("POST", "/pomodoro"), 200, sessionBody("work", 0, 1, 4));
        tryVerify(() => fixture.session.active, 3000, "a new session");
        compare(fixture.session.message, "");
        openMenu();
        verify(!menu.messageItem.visible);
        closeMenu();
    }

    function test_ringingPhaseConfirmsOnClick() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(fixture.session.setPomodoroMode(true));
        const label = findChild(button, "elapsedLabel");
        startSession(2);

        // Past the planned end the label counts the overtime.
        fixture.advance(minutes(25) + 5000);
        verify(fixture.session.ringing);
        compare(label.text, "+0:05");
        compare(button.words.summary, "Work · +0:05 overtime · Pomodoro 1 of 2");
        compare(button.Accessible.name, "Work · +0:05 overtime · Pomodoro 1 of 2");

        // A click confirms Next phase against the revision shown and opens no
        // menu. The phase changes when the server answers.
        mouseClick(button, 5, 5, Qt.LeftButton);
        const next = waitFor("POST", "/pomodoro/next");
        compare(fixture.request(next).body, {
            revision: revision
        });
        compare(fixture.session.phase, "work");
        fixture.respond(next, 200, sessionBody("shortRest", 0, 1, 2));
        compare(fixture.session.phase, "shortRest");
        verify(!fixture.session.ringing);
        verify(!button.menu.visible);
        compare(label.text, "5:00");
        compare(button.words.summary, "Short rest · 5:00 left · Pomodoro 1 of 2");
        checkSessionMenu({
            run: false,
            startSession: false,
            nextPhase: "Next phase: Work",
            endSession: true,
            mode: true,
            locked: true
        });
        compare(button.menu.stateItem.text, "Short rest · 5:00 left · Pomodoro 1 of 2");
        closeMenu();

        // Return on a ringing rest starts the next work phase.
        fixture.advance(minutes(5));
        compare(label.text, "+0:00");
        verify(fixture.session.ringing);
        focusButton();
        keyClick(Qt.Key_Return);
        fixture.respond(waitFor("POST", "/pomodoro/next"), 200, sessionBody("work", 0, 2, 2));
        compare(fixture.session.phase, "work");
        verify(!button.menu.visible);
        compare(button.words.summary, "Work · 25:00 left · Pomodoro 2 of 2");

        // The last work phase of the round leads to the long rest.
        checkSessionMenu({
            run: false,
            startSession: false,
            nextPhase: "Next phase: Long rest",
            endSession: true,
            mode: true,
            locked: true
        });
        moveTo(button.menu, button.menu.nextPhaseItem);
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after Next phase");
        fixture.respond(waitFor("POST", "/pomodoro/next"), 200, sessionBody("longRest", 0, 2, 2));
        compare(fixture.session.phase, "longRest");
        compare(button.words.summary, "Long rest · 15:00 left · Pomodoro 2 of 2");
        compare(label.text, "15:00");
    }

    // ----- a session started on another device ------------------------------

    function test_aSessionFromAnotherDeviceShowsInTimerMode() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        const session = fixture.session;
        const menu = button.menu;
        const label = findChild(button, "elapsedLabel");
        verify(!session.pomodoroMode, "this device is in Timer mode");
        compare(label.text, "0:00");
        checkWords("Stopped", "Start the Tokkl timer");

        // The web app starts a session; the event stream brings it.
        const foreign = pomodoroSession("work", -90, 1, 4);
        verify(fixture.push(stateBody(pomodoroEntry(foreign), null, foreign)), "an event stream is open");
        tryVerify(() => session.active, 3000, "the session shows");
        verify(button.timer.sessionActive);
        verify(!button.timer.running, "the pomodoro is the session's, not a timer's");
        verify(!glyph().visible, "the hourglass belongs to the mode");
        compare(label.text, "23:30");
        compare(button.words.summary, "Work · 23:30 left · Pomodoro 1 of 4");
        compare(button.Accessible.name, "Work · 23:30 left · Pomodoro 1 of 4");

        // The menu has the session's items, not the timer's Start or Stop,
        // and the mode is locked.
        const state = checkSessionMenu({
            run: false,
            startSession: false,
            nextPhase: "Next phase: Short rest",
            endSession: true,
            mode: false,
            locked: true
        });
        compare(state.stateItem.text, "Work · 23:30 left · Pomodoro 1 of 4");
        compare(menu.itemAt(menu.currentIndex), menu.nextPhaseItem);
        verify(!menu.runItem.enabled, "Start or Stop is not a choice");
        verify(!session.setPomodoroMode(true), "the mode is locked while the session runs");
        closeMenu();

        // A click mid-phase opens the menu and neither starts nor pauses
        // anything.
        const before = fixture.requestCount;
        mouseClick(button, 5, 5, Qt.LeftButton);
        tryVerify(() => menu.opened, 3000, "a click opens the menu");
        compare(fixture.requestCount, before, "nothing was sent");
        closeMenu();
        verify(!button.timer.toggle(), "the timer does nothing during a session");
        compare(fixture.requestCount, before);

        // Past the planned end it rings, and a click confirms Next phase.
        fixture.advance(minutes(24));
        verify(session.ringing);
        compare(label.text, "+0:30");
        mouseClick(button, 5, 5, Qt.LeftButton);
        const next = waitFor("POST", "/pomodoro/next");
        compare(fixture.request(next).body, {
            revision: revision
        });
        verify(!menu.visible);
        fixture.respond(next, 200, stateBody(pomodoroEntry(foreign), null, pomodoroSession("shortRest", 0, 1, 4)));
        compare(session.phase, "shortRest");

        // The web app ends it: the panel is the timer's again.
        verify(fixture.push(stateBody(null, null, null)));
        tryVerify(() => !session.active, 3000, "the session is gone");
        verify(!button.timer.sessionActive);
        compare(label.text, "0:00");
        checkWords("Stopped", "Start the Tokkl timer");
        const idle = checkSessionMenu({
            run: true,
            startSession: false,
            endSession: false,
            mode: false,
            locked: false
        });
        compare(idle.runItem.text, "Start");
        closeMenu();
    }

    function test_aSessionFoundAtConnectShowsInTimerMode() {
        const session = pomodoroSession("longRest", -60, 4, 4);
        connectAccount(instanceA, 3, 7, pomodoroEntry(session), undefined, undefined, session);
        verify(!fixture.session.pomodoroMode);
        verify(fixture.session.active);
        compare(fixture.session.phase, "longRest");
        compare(findChild(button, "elapsedLabel").text, "14:00");
        compare(button.words.summary, "Long rest · 14:00 left · Pomodoro 4 of 4");
        checkSessionMenu({
            run: false,
            startSession: false,
            nextPhase: "Next phase: Work",
            endSession: true,
            mode: false,
            locked: true
        });
        closeMenu();
    }

    function test_endSessionIsRefusedWhenTheSessionMovedOn() {
        const session = pomodoroSession("work", -30, 1, 4);
        connectAccount(instanceA, 3, 7, pomodoroEntry(session), undefined, undefined, session);
        openMenu();
        moveTo(button.menu, button.menu.endSessionItem);
        keyClick(Qt.Key_Return);
        tryVerify(() => !button.menu.visible, 3000, "menu closes after End session");
        const end = waitFor("POST", "/pomodoro/end");
        compare(fixture.request(end).body, {
            revision: revision
        });

        // The web app moved the session on first: the 409 brings its state.
        const moved = pomodoroSession("shortRest", 0, 1, 4);
        fixture.respond(end, 409, stateBody(pomodoroEntry(moved), null, moved));
        compare(fixture.session.phase, "shortRest", "the state that refused it shows");
        verify(fixture.session.active);
    }

    // ----- the session's messages ---------------------------------------------

    function test_sessionMessagesShowInTheMenuAndTheTooltipText() {
        const session = pomodoroSession("work", -30, 1, 4);
        connectAccount(instanceA, 3, 7, pomodoroEntry(session), undefined, undefined, session);
        const menu = button.menu;

        // The instance cannot be reached: the answer to Next phase says why.
        verify(fixture.session.confirmNextPhase());
        fixture.failNetwork(waitFor("POST", "/pomodoro/next"));
        tryVerify(() => fixture.session.message.length > 0, 3000, "a message");
        compare(fixture.session.message, "Could not reach the Tokkl instance: unreachable");
        compare(button.words.messageText, fixture.session.message);
        verify(button.words.summary.indexOf("Could not reach the Tokkl instance") >= 0, button.words.summary);
        verify(button.Accessible.description.indexOf("Could not reach the Tokkl instance") >= 0, button.Accessible.description);
        openMenu();
        verify(menu.messageItem.visible);
        verify(!menu.messageItem.enabled, "the message is not a choice");
        compare(menu.messageItem.text, fixture.session.message);
        closeMenu();

        // The outcome is unknown, so nothing is sent again until a read
        // settles it; the session still shows.
        verify(!fixture.session.confirmNextPhase());
        verify(!fixture.session.endSession());
        verify(fixture.session.active);
        answerState(pomodoroEntry(session), null, session);
        tryCompare(button.timer, "canWrite", true);
        verify(fixture.session.confirmNextPhase(), "possible again once the state is read");
        compare(fixture.session.message, "", "the next action clears it");
        verify(button.words.summary.indexOf("Could not reach") < 0);
    }

    function test_theTooShortNoticeShowsWhenAnotherDeviceEndsTheSession() {
        const session = pomodoroSession("work", -30, 1, 4);
        connectAccount(instanceA, 3, 7, pomodoroEntry(session), undefined, undefined, session);
        verify(fixture.push(stateBody(null, null, null, {
            entry_id: session.entry_id,
            start: fixture.clockIso(-30),
            stop: fixture.clockIso()
        })));
        tryVerify(() => !fixture.session.active, 3000, "the session is gone");
        compare(fixture.session.message, "This pomodoro was too short to save.");
        openMenu();
        compare(button.menu.messageItem.text, "This pomodoro was too short to save.");
        closeMenu();
    }

    function test_canStartSessionWaitsForTheStateAndForActions() {
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answer("GET", "/projects", 200, [project(11, 7, "Alpha", true)]);
        verify(fixture.session.setPomodoroMode(true));
        verify(!fixture.session.canStartSession, "no state has been read");
        verify(!fixture.session.startSession());
        compare(fixture.pending("POST", "/pomodoro"), -1);
        answerState(null);
        answer("GET", "/me/time_entries", 200, []);
        tryCompare(fixture.session, "canStartSession", true);

        // While the start waits for its answer, a second one is refused.
        verify(fixture.session.startSession());
        verify(!fixture.session.canStartSession);
        verify(!fixture.session.startSession());
        fixture.respond(waitFor("POST", "/pomodoro"), 200, sessionBody("work", 0, 1, 4));
        tryVerify(() => fixture.session.active, 3000, "the session shows");
        verify(!fixture.session.canStartSession, "not while a session is active");
    }

    function test_runningTimerInPomodoroModeKeepsItsControls() {
        connectAccount(instanceA, 3, 7);
        answer("GET", "/me/time_entries", 200, []);
        verify(fixture.session.setPomodoroMode(true));

        // Another client starts a timer; the next poll shows it.
        fixture.advance(31000);
        answerState(entry(9, 7, 11, true));
        tryCompare(button.timer, "running", true);
        verify(glyph().visible, "the hourglass stays in Pomodoro mode");
        compare(findChild(button, "elapsedLabel").text, "0:01");
        compare(button.Accessible.name, "Pause the Tokkl timer · Pomodoro mode");
        verify(button.words.summary.indexOf("Running 0:01 · Alpha") === 0, button.words.summary);
        checkSessionMenu({
            run: true,
            startSession: false,
            endSession: false,
            mode: true,
            locked: true
        });
        compare(button.menu.runItem.text, "Stop");
        closeMenu();

        // A click pauses it, as in Timer mode.
        mouseClick(button, 5, 5, Qt.LeftButton);
        fixture.respond(waitFor("POST", "/timer/pause"), 200, stateBody(null, pauseChain(true, 65, undefined, 11, true)));
        tryCompare(button.timer, "canWrite", true);
        verify(button.timer.paused);
        verify(fixture.session.modeLocked, "locked while paused");
        compare(button.Accessible.name, "Resume the Tokkl timer · Pomodoro mode");
        checkSessionMenu({
            run: true,
            startSession: false,
            endSession: false,
            mode: true,
            locked: true
        });
        compare(button.menu.runItem.text, "Stop");
        closeMenu();
    }
}
