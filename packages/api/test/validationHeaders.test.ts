import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { errorReply } from '../src/http/errors.ts';
import { forbidden, invalidInput } from '../src/lib/errors.ts';

const POMODORO_KEYS = [
  'pomodoro_focus_interval_in_minutes',
  'pomodoro_break_interval_in_minutes',
  'pomodoro_long_break_interval_in_minutes',
  'pomodoro_long_break_every',
];

test('the validation headers come only when asked for, and the body never changes', () => {
  const refused = invalidInput('Invalid theme: expected one of system, light, dark', {
    code: 'invalid_preference',
    field: 'theme',
  });
  assert.deepEqual(errorReply(refused), { status: 400, headers: {}, body: refused.message });
  assert.deepEqual(errorReply(refused, { validationHeaders: true }), {
    status: 400,
    headers: { 'Tokkl-Error-Code': 'invalid_preference', 'Tokkl-Error-Field': 'theme' },
    body: refused.message,
  });
  assert.deepEqual(errorReply(invalidInput('Bad'), { validationHeaders: true }).headers, {
    'Tokkl-Error-Code': 'invalid_input',
  });
  assert.deepEqual(errorReply(forbidden('No'), { validationHeaders: true }).headers, {});
});

test('a refused Pomodoro length names its preference under /api/app and nowhere else', async () => {
  const ctx = await setup();
  for (const key of POMODORO_KEYS) {
    for (const value of [0, 1000, 1.5, '5', null]) {
      const app = await ctx.request('POST', '/api/app/me/preferences', { [key]: value });
      const v9 = await ctx.request('POST', '/api/v9/me/preferences', { [key]: value });
      assert.equal(app.status, 400);
      assert.equal(app.headers.get('tokkl-error-code'), 'invalid_preference');
      assert.equal(app.headers.get('tokkl-error-field'), key);
      assert.equal(v9.status, 400);
      assert.equal(v9.headers.get('tokkl-error-code'), null);
      assert.equal(v9.headers.get('tokkl-error-field'), null);
      const message = await v9.text();
      assert.match(message, new RegExp(`^"Invalid ${key}: expected an integer from \\d+ to \\d+"$`));
      assert.equal(await app.text(), message);
    }
  }
  const saved = await ctx.json('POST', '/api/app/me/preferences', { pomodoro_focus_interval_in_minutes: 30 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.pomodoro_focus_interval_in_minutes, 30);
  assert.deepEqual((await ctx.json('GET', '/api/app/me/preferences')).body, saved.body);
  assert.deepEqual((await ctx.json('GET', '/api/v9/me/preferences')).body, saved.body);
});

test('other refusals under /api/app carry their code too', async () => {
  const ctx = await setup();
  const unknown = await ctx.request('PUT', '/api/app/admin/settings', { 'bad\nname': 1 });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get('tokkl-error-code'), 'unknown_setting');
  // Client text never becomes a header.
  assert.equal(unknown.headers.get('tokkl-error-field'), null);
  const invalid = await ctx.request('PUT', '/api/app/admin/settings', { session_days: 0 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('tokkl-error-code'), 'invalid_setting');
  assert.equal(invalid.headers.get('tokkl-error-field'), 'session_days');
  const report = await ctx.request('POST', '/api/app/report', { start_date: 'soon' });
  assert.equal(report.status, 400);
  assert.equal(report.headers.get('tokkl-error-code'), 'invalid_input');
  assert.equal(report.headers.get('tokkl-error-field'), null);
});
