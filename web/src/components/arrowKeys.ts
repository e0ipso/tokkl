/**
 * Index an arrow key, Home or End moves to in a list of `count` options, wrapping at the ends, or
 * null for any other key. `index` is -1 when no option is active yet: Down then goes to the first
 * option and Up to the last. A vertical list ignores Left and Right, which the caret or the page
 * may need.
 */
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
