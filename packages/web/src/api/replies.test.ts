import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detailedReportReply,
  entryListReply,
  meReply,
  projectListReply,
  reportReply,
  runningEntryReply,
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
