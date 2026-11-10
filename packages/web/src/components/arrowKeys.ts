/** Wraps at the ends; null for other keys. With `index` -1, Down goes first, Up last. Vertical ignores Left/Right. */
export function arrowTarget(key: string, index: number, count: number, vertical = false): number | null {
  if (count === 0) return null;
  const forward = key === 'ArrowDown' || (!vertical && key === 'ArrowRight');
  const back = key === 'ArrowUp' || (!vertical && key === 'ArrowLeft');
  if (forward) return (index + 1) % count;
  if (back) return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
