/** Down from the last suggestion wraps to the first; from no highlight (-1) it goes to the first. */
export function nextHighlight(highlight: number, count: number): number {
  return (highlight + 1) % count;
}

/** Up from the first suggestion, or from no highlight (-1), goes to the last. */
export function previousHighlight(highlight: number, count: number): number {
  return highlight <= 0 ? count - 1 : highlight - 1;
}

export type ComboboxKeyAction =
  | { kind: 'highlight'; index: number }
  | { kind: 'pick'; index: number }
  | { kind: 'enter' }
  | { kind: 'close' }
  | { kind: 'ignore' };

/**
 * What a key does in the description field, given the shown suggestions (`count`, 0 while the list is hidden)
 * and the highlight (-1 for none). Escape is ignored while no list shows, so it reaches an enclosing dialog.
 */
export function comboboxKeyAction(key: string, count: number, highlight: number): ComboboxKeyAction {
  switch (key) {
    case 'ArrowDown':
      return count > 0 ? { kind: 'highlight', index: nextHighlight(highlight, count) } : { kind: 'ignore' };
    case 'ArrowUp':
      return count > 0 ? { kind: 'highlight', index: previousHighlight(highlight, count) } : { kind: 'ignore' };
    case 'Enter':
      return highlight >= 0 && highlight < count ? { kind: 'pick', index: highlight } : { kind: 'enter' };
    case 'Escape':
      return count > 0 ? { kind: 'close' } : { kind: 'ignore' };
    default:
      return { kind: 'ignore' };
  }
}
