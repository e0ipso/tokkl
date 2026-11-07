/**
 * The part of an element `inertOutside` reads and writes, so tests can pass plain objects. Only
 * HTML elements have `inert`; an SVG child of the body is left as it is.
 */
export interface InertNode<T> {
  inert?: boolean;
  readonly children: Iterable<T>;
  contains(other: T | null): boolean;
}

/**
 * The attribute of an element that stays usable while a modal is open: the toast region, whose
 * messages must still be announced and whose Undo and Dismiss buttons sit above the backdrop.
 */
export const INERT_EXEMPT = 'data-inert-exempt';

/** How many open modals have made each element inert. An element stays inert while any does. */
const holds = new Map<object, number>();

/**
 * Makes everything under `root` inert except the `keep` elements and their ancestors, so the page
 * behind a modal dialog cannot be clicked, focused or read by assistive technology. Elements inert
 * for another reason are left alone. Returns the undo; stacked modals each hold their own share,
 * so closing one never wakes an element another still covers.
 */
export function inertOutside<T extends InertNode<T>>(root: T, keep: readonly T[]): () => void {
  const held: T[] = [];
  const visit = (parent: T) => {
    for (const child of parent.children) {
      if (keep.includes(child)) continue;
      if (keep.some(element => child.contains(element))) {
        visit(child);
        continue;
      }
      const count = holds.get(child);
      if (typeof child.inert !== 'boolean' || (count === undefined && child.inert)) continue;
      holds.set(child, (count ?? 0) + 1);
      child.inert = true;
      held.push(child);
    }
  };
  visit(root);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const element of held) {
      const count = (holds.get(element) ?? 1) - 1;
      if (count > 0) {
        holds.set(element, count);
      } else {
        holds.delete(element);
        element.inert = false;
      }
    }
  };
}
