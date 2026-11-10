/** Only HTML elements have `inert`; an SVG child of the body is left as it is. */
export interface InertNode<T> {
  inert?: boolean;
  readonly children: Iterable<T>;
  contains(other: T | null): boolean;
}

/** The toast region stays usable: its messages must be announced and its buttons sit above the backdrop. */
export const INERT_EXEMPT = 'data-inert-exempt';

/** An element stays inert while any modal holds it. */
const holds = new Map<object, number>();

/**
 * Leaves `keep`, their ancestors and already-inert elements alone. Each stacked modal holds its own share, so
 * closing one never wakes an element another covers.
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
