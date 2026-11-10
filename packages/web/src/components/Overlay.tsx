import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { t } from '../i18n/messages.ts';
import { INERT_EXEMPT, inertOutside } from './inertOutside.ts';
import { useOverlayLayer } from './overlayStack.tsx';
import { useFocusTrap } from './useFocusTrap.ts';

function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, anchor: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [ref, onClose, anchor]);
}

/** Below the anchor, or above when there is more room, inside the viewport. Written before paint after every render. */
function usePlacement(
  panel: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
  width: number,
  align: 'left' | 'right',
) {
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const target = anchor.current;
    element.style.setProperty('display', target ? '' : 'none');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const effectiveWidth = Math.min(width, viewportWidth - 16);
    const preferred = align === 'right' ? rect.right - effectiveWidth : rect.left;
    const left = Math.max(8, Math.min(preferred, viewportWidth - effectiveWidth - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 260 && rect.top > spaceBelow;
    Object.assign(element.style, {
      left: `${left}px`,
      width: `${effectiveWidth}px`,
      top: above ? '' : `${rect.bottom + 4}px`,
      bottom: above ? `${window.innerHeight - rect.top + 4}px` : '',
      maxHeight: `${above ? rect.top - 16 : spaceBelow - 16}px`,
    });
  });
}

/** Closed by Escape or a click outside. */
export function Popover({
  anchor,
  label,
  onClose,
  children,
  width = 300,
  align = 'left',
  panel,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
  /** For a caller that needs to know whether focus is inside it. */
  panel?: RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panel ?? own;
  useOverlayLayer();
  useDismiss(ref, onClose, anchor);
  usePlacement(ref, anchor, width, align);
  return createPortal(
    <div ref={ref} className="popover" role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

/** The page is inert while the modal is open, so focus can only land there once the close is committed. */
export function closeModalThen(close: () => void, focus: () => void): void {
  flushSync(close);
  focus();
}

/**
 * Modal by default: Tab cycles inside and the page is inert. `modal={false}` is for a draft the page may
 * replace, such as the all-day dialog: Tab leaves it and nothing goes inert.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  modal = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  modal?: boolean;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isTopmost = useOverlayLayer();
  const trapFocus = useFocusTrap();
  // Read on the first render, before anything inside the modal can take focus.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    // A popover over the modal takes Escape first; the modal closes only when it is on top.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmost()) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, isTopmost]);
  useEffect(() => {
    const dialog = ref.current;
    const first = dialog?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    // A modal with nothing else to focus, such as the shortcut list, takes focus on its close
    // button: the opener behind it is inert now.
    (first ?? (modal ? dialog?.querySelector<HTMLElement>('.modal-close') : null))?.focus();
    return () => {
      // Give focus back to the opener when closing would otherwise drop it, unless the caller has
      // already moved it elsewhere, as after deleting the row the opener sat in.
      const active = document.activeElement;
      const dropped = !active || active === document.body || dialog?.contains(active);
      if (dropped && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [opener, modal]);
  // A layout effect, so the page wakes in the commit that removes the modal, before focus goes back
  // to it. Popovers the modal opens are added to the body afterwards and stay usable.
  useLayoutEffect(() => {
    const element = backdrop.current;
    if (!modal || !element) return;
    return inertOutside(document.body, [element, ...document.querySelectorAll(`[${INERT_EXEMPT}]`)]);
  }, [modal]);
  return createPortal(
    <div
      ref={backdrop}
      className="modal-backdrop"
      onPointerDown={event => {
        if (event.target !== event.currentTarget) return;
        // Stops the press from focusing the page behind once the backdrop is gone.
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal={modal ? true : undefined}
        aria-label={title}
        onKeyDown={modal ? trapFocus : undefined}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
