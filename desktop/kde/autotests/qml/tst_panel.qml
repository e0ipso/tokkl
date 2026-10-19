import QtQuick
import QtTest
import org.kde.kirigami as Kirigami

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
        compare(button.Accessible.name, "Stop the Tokkl timer");
        verify(button.Accessible.description.indexOf("Running 0:01") === 0, button.Accessible.description);

        // Whole minutes: the label changes when the next minute starts.
        for (let i = 0; i < 54; ++i)
            fixture.advance(1000);
        compare(label.text, "0:01");
        fixture.advance(1000);
        compare(label.text, "0:02");
    }

    function test_leftClickAndSpaceStartAndStop() {
        connectAccount(instanceA, 3, 7);
        compare(button.words.runText, "Stopped");
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

        mouseClick(button, 5, 5, Qt.LeftButton);
        fixture.respond(waitFor("PATCH", "/time_entries/5/stop"), 200, JSON.stringify(entry(5, 7, 12, false, {
            stop: fixture.clockIso(),
            duration: 65
        })));
        answer("GET", "/me/time_entries/current", 200, "null");
        tryCompare(button.timer, "canWrite", true);
        verify(!button.timer.running);
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
        answer("GET", "/me/time_entries/current", 200, entry(5, 7, 12, true));
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
        answer("GET", "/me/time_entries/current", 200, "null");
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
        answer("GET", "/me/time_entries/current", 200, entry(9, 7, null, false));
        tryCompare(button.timer, "running", true);
        verify(ind.dashed, "a dashed circle while running");
        verify(ind.round);
        compare(ind.width, width);
        verify(button.words.summary.indexOf("No project") >= 0, button.words.summary);
    }

    function test_pendingProjectLeavesTheSlotEmpty() {
        fixture.configure(instanceA, "tok-3");
        answer("GET", "/me", 200, meBody(3, 7));
        answer("GET", "/me/time_entries/current", 200, entry(5, 7, 33, true));
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
