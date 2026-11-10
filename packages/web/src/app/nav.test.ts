import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isActive, sectionOf } from './nav.ts';

test('the timer link is active only on "/", other links on their subpaths too', () => {
  assert.equal(isActive('/', '/'), true);
  assert.equal(isActive('/', '/reports'), false);
  assert.equal(isActive('/reports', '/reports'), true);
  assert.equal(isActive('/settings', '/settings/anything'), true);
});

test('each page takes its nav section hue, and unknown paths fall back to the timer', () => {
  assert.equal(sectionOf('/reports'), 'reports');
  assert.equal(sectionOf('/tags'), 'more');
  assert.equal(sectionOf('/admin'), 'more');
  assert.equal(sectionOf('/'), 'timer');
  assert.equal(sectionOf('/nowhere'), 'timer');
});
