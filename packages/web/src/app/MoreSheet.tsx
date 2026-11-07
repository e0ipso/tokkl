import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../components/Icon.tsx';
import { INERT_EXEMPT, inertOutside } from '../components/inertOutside.ts';
import { t } from '../i18n/messages.ts';
import { useFocusTrap } from '../components/useFocusTrap.ts';

/**
 * The phone's More sheet: a modal dialog over the bottom bar. Focus starts on its first link, Tab
 * cycles inside it and the page behind is inert. Escape, the close button and a tap on the backdrop
 * all close it; the caller moves focus back to the More button once the sheet is gone.
 */
export function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const backdrop = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trapFocus = useFocusTrap();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a[href]')?.focus();
  }, []);
  // A layout effect, so the page wakes in the commit that removes the sheet.
  useLayoutEffect(() => {
    const keep = [backdrop.current, ref.current].filter(element => element !== null);
    return inertOutside(document.body, [...keep, ...document.querySelectorAll(`[${INERT_EXEMPT}]`)]);
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
      <div ref={backdrop} className="more-backdrop" onClick={onClose} />
      <div
        ref={ref}
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.more')}
        onKeyDown={onKeyDown}
      >
        <div className="more-sheet-head">
          <h2>{t('shell.more')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
