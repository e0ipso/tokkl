import { useCallback, type KeyboardEvent } from 'react';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(', ');

/** The controls Tab stops on inside `container`, in document order. */
export function tabbables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    element => element.tabIndex >= 0 && !element.hidden && element.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab inside a modal dialog: Tab on the last control moves to the first, and Shift+Tab on the
 * first moves to the last. Put the returned handler on the dialog's onKeyDown. Focus inside a
 * popover the dialog opened is left alone, since it is neither the first nor the last control.
 */
export function useFocusTrap(): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const controls = tabbables(event.currentTarget);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);
}
