import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecodeError, ignoreReply } from './decode.ts';
import {
  adminAccountListReply,
  adminAccountReply,
  appStatusReply,
  bulkPatchResultReply,
  createdInviteReply,
  detailedReportReply,
  entryListReply,
  importResultReply,
  instanceSettingsReply,
  inviteCheckReply,
  inviteListReply,
  jsonRestoreResultReply,
  meReply,
  passwordResetLinkReply,
  preferencesReply,
  projectListReply,
  reportReply,
  resetCheckReply,
  runningEntryReply,
  trashEmptiedReply,
  weeklyReportReply,
} from './replies.ts';

// Shaped like the server's presenters, Toggl-only fields included.
const me = {
  id: 1,
  api_token: 'token',
  email: 'a@example.com',
  fullname: 'A',
  timezone: 'Europe/Madrid',
  default_workspace_id: 2,
  beginning_of_week: 1,
  role: 'user',
  time_resolution_minutes: 1,
  image_url: '',
  oauth_providers: [],
};

const entry = {
  id: 3,
  workspace_id: 2,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T10:00:00+00:00',
  stop: null,
  duration: -1793095200,
  description: 'Write',
  tags: ['a'],
  tag_ids: [4],
  at: '2026-10-27T10:00:00+00:00',
  server_deleted_at: null,
  all_day: false,
  duronly: true,
  pid: null,
};

test('the account reply keeps every field it came with', () => {
  assert.deepEqual(meReply(me), me);
  assert.throws(() => meReply({ ...me, role: 'owner' }), { message: /reply\.role is not one of admin, user/ });
});

test('entry lists accept meta fields and refuse malformed rows', () => {
  const withMeta = { ...entry, project_name: 'P', project_color: '#000', client_name: null, task_name: null };
  assert.deepEqual(entryListReply([entry, withMeta]), [entry, withMeta]);
  assert.throws(() => entryListReply([{ ...entry, tags: 'a' }]), { message: /reply\[0\]\.tags is not a list/ });
});

test('entry ids must be whole numbers and times real instants', () => {
  assert.throws(() => entryListReply([{ ...entry, id: 3.5 }]), { message: /reply\[0\]\.id is not a whole number/ });
  assert.throws(() => entryListReply([{ ...entry, tag_ids: [4.2] }]), {
    message: /reply\[0\]\.tag_ids\[0\] is not a whole number/,
  });
  assert.throws(() => entryListReply([{ ...entry, start: '2026-10-27T10:00:00' }]), {
    message: /reply\[0\]\.start is not a date and time with a time zone/,
  });
  assert.throws(() => entryListReply([{ ...entry, stop: '2026-13-01T10:00:00Z' }]), {
    message: /reply\[0\]\.stop is not a date and time/,
  });
});

test('the running entry may be null', () => {
  assert.equal(runningEntryReply(null), null);
  assert.deepEqual(runningEntryReply(entry), entry);
});

test('projects need their numbers and names', () => {
  const project = {
    id: 5,
    workspace_id: 2,
    client_id: null,
    client_name: null,
    name: 'P',
    color: '#06aaf5',
    active: true,
    billable: false,
    estimated_hours: null,
    rate: null,
    currency: null,
    actual_seconds: 0,
    status: 'active',
  };
  assert.deepEqual(projectListReply([project]), [project]);
  assert.throws(() => projectListReply([{ ...project, actual_seconds: '0' }]), {
    message: /reply\[0\]\.actual_seconds is not a number/,
  });
});

test('report groups are checked at every level', () => {
  const group = { id: 1, title: 'P', color: null, seconds: 60, billable_seconds: 0, amount_cents: 0, sub_groups: [] };
  const report = {
    start_date: '2026-10-26',
    end_date: '2026-11-01',
    resolution: 'day',
    week_start: '2026-10-26',
    totals: { seconds: 60, billable_seconds: 0, entry_count: 1, amounts: [] },
    series: [{ start: '2026-10-26', seconds: 60, billable_seconds: 0 }],
    groups: [{ ...group, sub_groups: [group] }],
  };
  assert.deepEqual(reportReply(report), report);
  const broken = { ...report, groups: [{ ...group, sub_groups: [{ ...group, seconds: null }] }] };
  assert.throws(() => reportReply(broken), { message: /reply\.groups\[0\]\.sub_groups\[0\]\.seconds is not a number/ });
});

test('detailed and weekly report pages decode', () => {
  const page = { total: 0, page: 1, page_size: 100, pages: 1, has_amounts: false, entries: [] };
  assert.deepEqual(detailedReportReply(page), page);
  const weekly = {
    start_date: '2026-10-26',
    end_date: '2026-11-01',
    mode: 'days',
    columns: [{ start: '2026-10-26', end: '2026-10-26' }],
    rows: [{ id: null, title: '', color: null, cells: [60], total: 60 }],
    column_totals: [60],
    total: 60,
  };
  assert.deepEqual(weeklyReportReply(weekly), weekly);
  assert.throws(() => weeklyReportReply({ ...weekly, mode: 'months' }), { message: /reply\.mode/ });
});

// What getPreferences sends: a default for every preference the app reads, plus keys other clients saved.
const preferences = {
  date_format: 'YYYY-MM-DD',
  timeofday_format: 'H:mm',
  duration_format: 'improved',
  collapseTimeEntries: true,
  manualMode: false,
  pg_time_zone_name: 'UTC',
  record_timeline: false,
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  pomodoro_long_break_interval_in_minutes: 15,
  pomodoro_long_break_every: 4,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
  keyboard_shortcuts_enabled: true,
  theme: 'system',
  timerView: 'calendar',
  desktop_only_key: { nested: [1] },
};

const at = (expected: string) => (error: unknown) => error instanceof DecodeError && error.at === expected;

test('preferences decode with or without favorites, and keys other clients saved pass through', () => {
  assert.equal(preferencesReply(preferences), preferences);
  const favorites = [{ description: 'Write', project_id: 3, task_id: null, tags: ['deep'], billable: true }];
  assert.deepEqual(preferencesReply({ ...preferences, favorites, showTimeInTitle: true }).favorites, favorites);
});

test('a preference the views read that has the wrong shape fails the reply, naming it', () => {
  assert.throws(() => preferencesReply({ ...preferences, favorites: 5 }), at('reply.favorites'));
  assert.throws(
    () => preferencesReply({ ...preferences, favorites: [{ description: 'Write', tags: 'deep' }] }),
    at('reply.favorites[0].project_id'),
  );
  assert.throws(() => preferencesReply({ ...preferences, theme: 'sepia' }), at('reply.theme'));
  assert.throws(() => preferencesReply({ ...preferences, manualMode: 'yes' }), at('reply.manualMode'));
  const { long_timer_reminder_hours: _, ...missing } = preferences;
  assert.throws(() => preferencesReply(missing), at('reply.long_timer_reminder_hours'));
});

test('the status, invite and reset link checks and the admin lists decode their replies', () => {
  const limit = { min: 1, max: 60, default: 5 };
  const pomodoro_limits = {
    work_minutes: { min: 1, max: 180, default: 25 },
    short_rest_minutes: limit,
    long_rest_minutes: limit,
    long_rest_every: limit,
  };
  const status = {
    setup_required: false,
    api_version: 1,
    capabilities: ['timer-actions', 'timer-edit'],
    pomodoro_limits,
  };
  assert.deepEqual(appStatusReply(status), status);
  const current = {
    ...status,
    capabilities: ['pomodoro-revision', 'pause-revision', 'timer-edit-entry', 'idempotency-keys'],
  };
  assert.deepEqual(appStatusReply(current), current);
  assert.throws(() => appStatusReply({ ...status, setup_required: 'no' }), at('reply.setup_required'));
  // A newer server may announce capabilities this app does not know: the status still reads,
  // without them, and the reply itself is left as it came.
  const newer = { ...status, capabilities: ['teleport', 'timer-actions', 'timer-edit', 'time-travel'] };
  assert.deepEqual(appStatusReply(newer), status);
  assert.deepEqual(newer.capabilities, ['teleport', 'timer-actions', 'timer-edit', 'time-travel']);
  assert.throws(() => appStatusReply({ ...status, capabilities: 'timer-actions' }), at('reply.capabilities'));
  assert.throws(() => appStatusReply({ ...status, capabilities: ['timer-actions', 7] }), at('reply.capabilities[1]'));
  assert.throws(() => appStatusReply({ ...status, capabilities: null }), at('reply.capabilities'));
  const { pomodoro_limits: _, ...withoutLimits } = status;
  assert.throws(() => appStatusReply(withoutLimits), at('reply.pomodoro_limits'));
  assert.throws(
    () =>
      appStatusReply({ ...status, pomodoro_limits: { ...pomodoro_limits, long_rest_every: { ...limit, max: 1.5 } } }),
    at('reply.pomodoro_limits.long_rest_every.max'),
  );
  assert.deepEqual(inviteCheckReply({ role: 'admin' }), { role: 'admin' });
  assert.throws(() => inviteCheckReply({ role: 'owner' }), at('reply.role'));
  assert.deepEqual(resetCheckReply({ email: 'a@example.com' }), { email: 'a@example.com' });
  assert.throws(() => resetCheckReply({}), at('reply.email'));

  const account = {
    id: 1,
    email: 'a@example.com',
    fullname: 'A',
    role: 'user',
    created_at: '2026-10-27T10:00:00+00:00',
    disabled_at: null,
  };
  assert.equal(adminAccountListReply([account]).length, 1);
  assert.throws(() => adminAccountListReply([{ ...account, disabled_at: 'yesterday' }]), at('reply[0].disabled_at'));
  const invite = {
    id: 2,
    role: 'user',
    note: null,
    created_by: 1,
    created_at: '2026-10-27T10:00:00+00:00',
    expires_at: '2026-11-03T10:00:00+00:00',
  };
  assert.equal(inviteListReply([invite]).length, 1);
  assert.throws(() => inviteListReply({ invites: [invite] }), at('reply'));
  const settings = { session_days: 30, invite_days: 7, time_resolution_minutes: 5 };
  assert.deepEqual(instanceSettingsReply(settings), settings);
  assert.throws(() => instanceSettingsReply({ ...settings, invite_days: 1.5 }), at('reply.invite_days'));
});

test('the admin write replies the views read decode, and a broken one names its field', () => {
  const account = {
    id: 1,
    email: 'a@example.com',
    fullname: 'A',
    role: 'admin',
    created_at: '2026-10-27T10:00:00+00:00',
    disabled_at: null,
  };
  assert.deepEqual(adminAccountReply(account), account);
  assert.throws(() => adminAccountReply({ ...account, role: 'owner' }), at('reply.role'));
  const invite = {
    id: 2,
    role: 'user',
    note: 'For B',
    created_by: 1,
    created_at: '2026-10-27T10:00:00+00:00',
    expires_at: '2026-11-03T10:00:00+00:00',
    url: '/invite/abc',
  };
  assert.deepEqual(createdInviteReply(invite), invite);
  const { url: _, ...withoutUrl } = invite;
  assert.throws(() => createdInviteReply(withoutUrl), at('reply.url'));
  const link = { url: '/reset-password/abc', expires_at: '2026-10-28T10:00:00+00:00' };
  assert.deepEqual(passwordResetLinkReply(link), link);
  assert.throws(() => passwordResetLinkReply({ ...link, expires_at: 'tomorrow' }), at('reply.expires_at'));
});

test('the entry write replies the views read decode: emptied trash and a bulk edit', () => {
  assert.deepEqual(trashEmptiedReply({ deleted: 3 }), { deleted: 3 });
  assert.throws(() => trashEmptiedReply({ deleted: '3' }), at('reply.deleted'));
  const bulk = { success: [1, 2], failure: [{ id: 3, message: 'Entry not found' }] };
  assert.deepEqual(bulkPatchResultReply(bulk), bulk);
  assert.throws(() => bulkPatchResultReply({ ...bulk, failure: [{ id: 3 }] }), at('reply.failure[0].message'));
  assert.throws(() => bulkPatchResultReply({ success: null, failure: [] }), at('reply.success'));
});

test('import and restore results decode, the file id of a restore error as it came', () => {
  const imported = {
    dry_run: true,
    rows: 4,
    created: 2,
    skipped_duplicates: 1,
    created_projects: ['Site'],
    created_clients: [],
    errors: [{ row: 3, message: 'Invalid start' }],
    users: [{ key: 'k1', user: 'A', email: 'a@example.com', rows: 4 }],
    skipped: [{ rows: 2, reason: 'Not selected' }],
  };
  assert.deepEqual(importResultReply(imported), imported);
  assert.throws(() => importResultReply({ ...imported, users: [{ key: 'k1' }] }), at('reply.users[0].user'));
  assert.throws(() => importResultReply({ ...imported, created: '2' }), at('reply.created'));
  const restored = {
    dry_run: false,
    clients: 1,
    projects: 2,
    tasks: 0,
    tags: 3,
    time_entries: 10,
    skipped_duplicates: 0,
    errors: [
      { entity: 'project', id: 'p-7', message: 'Missing name' },
      { entity: 'time_entry', id: null, message: 'Missing start' },
    ],
  };
  assert.deepEqual(jsonRestoreResultReply(restored), restored);
  assert.throws(() => jsonRestoreResultReply({ ...restored, errors: [{ id: 1 }] }), at('reply.errors[0].entity'));
});

test('a write whose reply nothing reads gets nothing, whatever came back', () => {
  assert.equal(ignoreReply({ id: 1 }), undefined);
  assert.equal(ignoreReply(null), undefined);
  assert.equal(ignoreReply('token'), undefined);
});
