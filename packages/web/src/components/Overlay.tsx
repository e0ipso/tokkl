import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, anchor?: HTMLElement | null) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
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

/** A floating panel placed under `anchor`, closed by Escape or a click outside. */
export function Popover({ anchor, onClose, children, width = 300, align = 'left' }: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, anchor);
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const effectiveWidth = Math.min(width, viewportWidth - 16);
  let left = align === 'right' ? rect.right - effectiveWidth : rect.left;
  left = Math.max(8, Math.min(left, viewportWidth - effectiveWidth - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  const style: React.CSSProperties = spaceBelow < 260 && rect.top > spaceBelow
    ? { left, bottom: window.innerHeight - rect.top + 4, width: effectiveWidth, maxHeight: rect.top - 16 }
    : { left, top: rect.bottom + 4, width: effectiveWidth, maxHeight: spaceBelow - 16 };
  return createPortal(
    <div ref={ref} className="popover" style={style} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Read on the first render, before anything inside the modal can take focus.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.popover')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
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
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Stops the press from focusing the page behind once the backdrop is gone.
        event.preventDefault();
        onClose();
      }}
    >
      <div ref={ref} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
