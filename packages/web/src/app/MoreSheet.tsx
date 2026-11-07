import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useFocusTrap } from '../components/useFocusTrap.ts';

/**
 * The phone's More sheet: a modal dialog over the bottom bar. Focus starts on its first link and Tab
 * cycles inside it. Escape, the close button and a tap on the backdrop all close it; the caller
 * moves focus back to the More button.
 */
export function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const trapFocus = useFocusTrap();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a[href]')?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    trapFocus(event);
  };
  return (
    <>
      <div className="more-backdrop" onClick={onClose} />
      <div ref={ref} className="more-sheet" role="dialog" aria-modal="true" aria-label="More" onKeyDown={onKeyDown}>
        <div className="more-sheet-head">
          <h2>More</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
