import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { en, t, template } from './messages.ts';
import { tx } from './rich.ts';

test('t fills named placeholders from the catalog', () => {
  assert.equal(t('manage.deleteNamed', { name: 'Website' }), 'Delete Website?');
  assert.equal(t('dates.timeRange', { start: '09:00', end: '10:30' }), '09:00 – 10:30');
  assert.equal(t('common.cancel'), 'Cancel');
});

test('t picks the English plural form for 0, 1 and 2', () => {
  assert.deepEqual(
    [0, 1, 2].map(count => t('entries.count', { count })),
    ['0 entries', '1 entry', '2 entries'],
  );
  assert.deepEqual(
    [0, 1, 2].map(count => t('settings.stepHours', { count })),
    ['0 hours', '1 hour', '2 hours'],
  );
  assert.equal(template('timer.reminderText', 1), en.timer.reminderText.one);
});

test('every catalog key has the feature.message shape and no empty message', () => {
  for (const [feature, group] of Object.entries(en)) {
    for (const [name, message] of Object.entries(group)) {
      assert.match(`${feature}.${name}`, /^[a-z]+\.[A-Za-z0-9]+$/);
      const forms: unknown[] = typeof message === 'string' ? [message] : Object.values(message);
      assert.ok(
        forms.every(form => typeof form === 'string' && form.length > 0),
        `${feature}.${name}`,
      );
    }
  }
});

test('tx puts React nodes where the placeholders are and keeps the text around them', () => {
  const browser = createElement('strong', null, 'Europe/Madrid');
  const account = createElement('strong', null, 'UTC');
  const node = tx('settings.browserZone', { browser, account });
  assert.ok(isValidElement(node));
  const children = (node as ReactElement<{ children: ReactNode[] }>).props.children;
  assert.deepEqual(children, ['This browser is set to ', browser, ', but the account uses ', account, '.']);
});
