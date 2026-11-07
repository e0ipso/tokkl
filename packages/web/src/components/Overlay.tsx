import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayLayer } from './overlayStack.tsx';

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

/**
 * Places the panel under its anchor, or above it when there is more room there, kept inside the
 * viewport. It writes the position straight to the panel before paint, after every render, so the
 * panel follows the anchor whenever its content changes.
 */
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

/** A floating panel placed under `anchor`, closed by Escape or a click outside. */
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
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
  /** Receives the panel element, for a caller that needs to know whether focus is inside it. */
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

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isTopmost = useOverlayLayer();
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
    first?.focus();
    return () => {
      // Give focus back to the opener when closing would otherwise drop it, unless the caller has
      // already moved it elsewhere, as after deleting the row the opener sat in.
      const active = document.activeElement;
      const dropped = !active || active === document.body || dialog?.contains(active);
      if (dropped && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [opener]);
  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={event => {
        if (event.target !== event.currentTarget) return;
        // Stops the press from focusing the page behind once the backdrop is gone.
        event.preventDefault();
        onClose();
      }}
    >
      <div ref={ref} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close">
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
