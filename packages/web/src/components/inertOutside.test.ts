import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inertOutside, type InertNode } from './inertOutside.ts';

interface FakeNode extends InertNode<FakeNode> {
  inert: boolean;
}

function node(...children: FakeNode[]): FakeNode {
  const self: FakeNode = {
    inert: false,
    children,
    contains: other => other === self || children.some(child => child.contains(other)),
  };
  return self;
}

test('everything but the kept elements and their ancestors goes inert, and comes back', () => {
  const toasts = node();
  const page = node();
  const root = node(page, toasts);
  const dialog = node();
  const popover = node();
  const body = node(root, dialog, popover);

  const release = inertOutside(body, [dialog, toasts]);
  assert.deepEqual(
    [root.inert, page.inert, toasts.inert, dialog.inert, popover.inert],
    [false, true, false, false, true],
  );
  release();
  assert.deepEqual([page.inert, popover.inert], [false, false]);
});

test('an element inert before the modal opened stays inert after it closes', () => {
  const hidden = node();
  hidden.inert = true;
  const dialog = node();
  const release = inertOutside(node(hidden, dialog), [dialog]);
  release();
  assert.equal(hidden.inert, true);
});

test('stacked modals wake an element only when the last one covering it closes', () => {
  const page = node();
  const first = node();
  const second = node();
  const children = [page, first];
  const body = node();
  Object.assign(body, { children, contains: (other: FakeNode | null) => children.some(c => c.contains(other)) });

  const releaseFirst = inertOutside(body, [first]);
  children.push(second);
  const releaseSecond = inertOutside(body, [second]);
  assert.deepEqual([page.inert, first.inert, second.inert], [true, true, false]);

  releaseFirst();
  assert.equal(page.inert, true);
  releaseSecond();
  assert.deepEqual([page.inert, first.inert], [false, false]);
});

test('releasing twice does not wake what another modal still holds', () => {
  const page = node();
  const first = node();
  const second = node();
  const body = node(page, first, second);
  const releaseFirst = inertOutside(body, [first, second]);
  const releaseSecond = inertOutside(body, [second, first]);
  releaseFirst();
  releaseFirst();
  assert.equal(page.inert, true);
  releaseSecond();
  assert.equal(page.inert, false);
});
