import QtQuick
import QtTest

import com.github.e0ipso.tokkl.backend
import Tokkl.Test

import "../../package/contents/ui"

// The panel item and its menu, against a scripted instance. Every request
// goes to the fake transport in PanelFixture; time comes from its fake clock.
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

    Component {
        id: fixtureComponent
        PanelFixture {}
    }

    Component {
        id: buttonComponent
        PanelButton {}
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

    // Configures the instance, validates the account and answers the first
    // current-entry and project reads.
    function connectAccount(url, user, workspace, current, projects) {
        fixture.configure(url, "tok-" + user);
        answer("GET", "/me", 200, meBody(user, workspace));
        answer("GET", "/me/time_entries/current", 200, current === undefined ? "null" : JSON.stringify(current));
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
        const projectEntry = button.menu.itemAt(button.menu.currentIndex);
        compare(projectEntry.subMenu, button.menu.projectMenu, "the first entry is the Project submenu");
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
        fixture = fixtureComponent.createObject(testCase);
        button = buttonComponent.createObject(testCase, {
            timer: fixture.timer
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
        compare(label.text, "0:01:05");
        verify(label.visible);
        compare(button.words.runText, "Running");
        compare(findChild(button, "runIcon").source, "media-playback-playing");
        compare(button.Accessible.name, "Stop the Tokkl timer");
        verify(button.Accessible.description.indexOf("Running 0:01:05") === 0, button.Accessible.description);

        fixture.advance(1000);
        compare(label.text, "0:01:06");
    }

    function test_leftClickAndSpaceStartAndStop() {
        connectAccount(instanceA, 3, 7);
        compare(button.words.runText, "Stopped");
        compare(findChild(button, "runIcon").source, "media-playback-stopped");
        compare(button.Accessible.name, "Start the Tokkl timer");

        mouseClick(button, 5, 5, Qt.LeftButton);
        const start = waitFor("POST", "/workspaces/7/time_entries");
        const body = fixture.request(start).body;
        compare(body.project_id, null, "No project at first");
        compare(body.billable, false, "nonbillable at first");
        compare(button.timer.status, TokklTimer.Busy);
        compare(button.words.statusText, "Saving");

        fixture.respond(start, 200, JSON.stringify(entry(9, 7, null, false, {
            start: fixture.clockIso()
        })));
        answer("GET", "/me/time_entries/current", 200, entry(9, 7, null, false, {
            start: fixture.clockIso()
        }));
        tryCompare(button.timer, "running", true);
        tryCompare(button.timer, "canWrite", true);

        button.forceActiveFocus(Qt.TabFocusReason);
        keyClick(Qt.Key_Space);
        const stop = waitFor("PATCH", "/time_entries/9/stop");
        verify(stop > start);
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
        compare(menu.itemAt(menu.currentIndex).subMenu, menu.projectMenu, "Project is highlighted first");
        compare(menu.projectMenu.title, "Project: No project");
        verify(!menu.stateItem.enabled, "the state line is not a choice");
        compare(menu.stateItem.text, "Stopped 0:00:00 · Connected");

        // Every action is reachable with the arrow keys and has a label.
        const labels = [];
        for (let i = 0; i < menu.count + 1; ++i) {
            const item = menu.itemAt(menu.currentIndex);
            if (labels.indexOf(item.text) < 0) {
                labels.push(item.text);
            }
            keyClick(Qt.Key_Down);
        }
        verify(labels.indexOf("Project: No project") >= 0, labels);
        verify(labels.indexOf("Billable") >= 0, labels);
        verify(labels.indexOf("Reconnect") >= 0, labels);
        verify(labels.indexOf("Open Tokkl") >= 0, labels);
        verify(labels.indexOf("Configure Tokkl…") >= 0, labels);

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

    function test_projectsFollowPagination() {
        const firstPage = [];
        for (let i = 1; i <= 200; ++i) {
            firstPage.push(project(100 + i, 7, "Project " + i, false));
        }
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answer("GET", "/me/time_entries/current", 200, "null");
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
        answer("GET", "/me/time_entries/current", 200, "null");
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
        answer("GET", "/me/time_entries/current", 200, entry(5, 7, 33, true));
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

        // Moving the entry to an active project drops the archived line.
        chooseProjectWithKeyboard("Alpha");
        const put = waitFor("PUT", "/time_entries/5");
        fixture.respond(put, 200, JSON.stringify(entry(5, 7, 11, true, {
            task_id: null
        })));
        tryCompare(menu, "count", 2);
        verify(!projectItem("Legacy (archived)"));
    }

    function test_runningChangesEditTheWholeEntry() {
        connectAccount(instanceA, 3, 7, entry(5, 7, 12, false));
        const before = fixture.requestCount;

        chooseProjectWithKeyboard("Alpha");
        const put = waitFor("PUT", "/workspaces/7/time_entries/5");
        const body = fixture.request(put).body;
        compare(Object.keys(body).sort(), ["billable", "project_id", "task_id"], "only the changed fields travel");
        compare(body.project_id, 11);
        compare(body.billable, true, "Alpha's default");
        compare(body.task_id, null);
        compare(button.timer.status, TokklTimer.Busy);
        verify(!button.menu.billableItem.enabled, "no second edit while one runs");

        // The server keeps everything else; the same entry keeps running.
        fixture.respond(put, 200, JSON.stringify(entry(5, 7, 11, true, {
            task_id: null
        })));
        answer("GET", "/me/time_entries/current", 200, entry(5, 7, 11, true, {
            task_id: null
        }));
        tryCompare(button.timer, "canWrite", true);
        const current = button.timer.currentEntry;
        compare(current.id, 5);
        compare(current.description, "Write the report");
        compare(current.tags, ["deep work", "q4"]);
        verify(current.running);
        compare(button.timer.elapsedText, "0:01:05", "not split: the start is unchanged");
        compare(fixture.pending("POST", "/time_entries"), -1, "no new entry");
        compare(fixture.pending("PATCH", "/stop"), -1, "no stop");
        verify(button.menu.billableItem.checked);

        toggleBillableWithKeyboard();
        const billablePut = waitFor("PUT", "/workspaces/7/time_entries/5");
        compare(fixture.request(billablePut).body, {
            billable: false
        }, "a billable change sends only billable");
        for (let i = before; i < fixture.requestCount; ++i) {
            const request = fixture.request(i);
            verify(request.method === "GET" || request.method === "PUT", request.method + " " + request.path);
        }
    }

    // ----- states and disabled controls -----------------------------------

    function test_unconfiguredDisablesEverything() {
        compare(button.timer.status, TokklTimer.Unconfigured);
        compare(button.words.statusText, "Not configured");
        verify(button.words.detailText.length > 0);
        openMenu();
        const menu = button.menu;
        verify(!menu.projectMenu.enabled);
        verify(!menu.billableItem.enabled);
        verify(!menu.openItem.enabled, "no address to open");
        verify(!menu.reconnectItem.enabled);
        verify(menu.configureItem.enabled);
        compare(menu.itemAt(menu.currentIndex), menu.configureItem, "focus starts on the first enabled entry");
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
        answer("GET", "/me/time_entries/current", 200, "null");
        record(TokklTimer.Ready);
        verify(!findChild(button, "stateIcon").visible, "no state symbol when ready");

        mouseClick(button, 5, 5, Qt.LeftButton);
        record(TokklTimer.Busy);
        verify(!button.menu.billableItem.enabled);
        fixture.respond(waitFor("POST", "/time_entries"), 200, JSON.stringify(entry(9, 7, null, false)));
        answer("GET", "/me/time_entries/current", 200, entry(9, 7, null, false));
        tryCompare(button.timer, "status", TokklTimer.Ready);

        fixture.advance(31000);
        fixture.failNetwork(waitFor("GET", "/me/time_entries/current"));
        record(TokklTimer.Stale);
        verify(button.timer.running, "the last known entry stays");

        fixture.advance(31000);
        answer("GET", "/me/time_entries/current", 401, JSON.stringify("Invalid credentials"));
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

    // ----- accounts --------------------------------------------------------

    function test_switchingAccountsClearsChoices() {
        connectAccount(instanceA, 3, 7);
        chooseProjectWithKeyboard("Alpha");
        toggleBillableWithKeyboard();
        compare(button.timer.chosenProjectId, 11);
        verify(!button.timer.chosenBillable);

        // A read of the first account is still in flight at the switch.
        fixture.advance(31000);
        const lateRead = waitFor("GET", "/me/time_entries/current");

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
        fixture.respond(lateRead, 200, JSON.stringify(entry(77, 7, 11, true)));
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
}
