import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comboboxKeyAction, nextHighlight, previousHighlight } from './descriptionCombobox.ts';

test('the highlight wraps at both ends, and Up from no highlight goes to the last suggestion', () => {
  assert.equal(nextHighlight(-1, 3), 0);
  assert.equal(nextHighlight(1, 3), 2);
  assert.equal(nextHighlight(2, 3), 0, 'Down from the last wraps to the first');
  assert.equal(previousHighlight(-1, 3), 2, 'Up from no highlight goes to the last');
  assert.equal(previousHighlight(0, 3), 2, 'Up from the first wraps to the last');
  assert.equal(previousHighlight(2, 3), 1);
  assert.deepEqual(comboboxKeyAction('ArrowDown', 3, 2), { kind: 'highlight', index: 0 });
  assert.deepEqual(comboboxKeyAction('ArrowUp', 3, -1), { kind: 'highlight', index: 2 });
  assert.deepEqual(comboboxKeyAction('ArrowUp', 3, 0), { kind: 'highlight', index: 2 });
});

test('Enter picks the highlighted suggestion, and calls Enter with no highlight or a stale one', () => {
  assert.deepEqual(comboboxKeyAction('Enter', 3, 1), { kind: 'pick', index: 1 });
  assert.deepEqual(comboboxKeyAction('Enter', 3, -1), { kind: 'enter' });
  assert.deepEqual(comboboxKeyAction('Enter', 0, -1), { kind: 'enter' });
  assert.deepEqual(comboboxKeyAction('Enter', 2, 5), { kind: 'enter' }, 'a highlight past a shrunk list');
});

test('Escape closes an open list and is ignored when no list shows, so it reaches an enclosing dialog', () => {
  assert.deepEqual(comboboxKeyAction('Escape', 3, -1), { kind: 'close' });
  assert.deepEqual(comboboxKeyAction('Escape', 1, 0), { kind: 'close' });
  assert.deepEqual(comboboxKeyAction('Escape', 0, -1), { kind: 'ignore' });
});

test('arrow keys with no suggestions and keys the combobox does not own are ignored', () => {
  assert.deepEqual(comboboxKeyAction('ArrowDown', 0, -1), { kind: 'ignore' });
  assert.deepEqual(comboboxKeyAction('ArrowUp', 0, -1), { kind: 'ignore' });
  for (const key of ['a', '@', '#', 'Tab', 'ArrowLeft', 'Home']) {
    assert.deepEqual(comboboxKeyAction(key, 3, 1), { kind: 'ignore' }, key);
  }
});
