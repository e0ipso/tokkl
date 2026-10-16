import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Modal, Popover } from '../../components/Overlay.tsx';

/** Asks before a destructive or wide-reaching action. */
export function ConfirmModal({ title, children, confirmLabel, danger = true, busy = false, onConfirm, onClose, extraActions }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Extra buttons placed before the confirm button, for choices like "delete entries too". */
  extraActions?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          {extraActions}
          <button
            type="button"
            className={`button ${danger ? 'button-danger' : 'button-primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="manage-confirm">{children}</div>
    </Modal>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Search field with a leading icon. The accessible name defaults to the placeholder. */
export function SearchBox({ value, onChange, placeholder, label = placeholder }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  return (
    <label className="search-box">
      <Icon name="search" size={16} />
      <input type="search" value={value} placeholder={placeholder} aria-label={label} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A "more" button that opens a small action menu for a table row. Its `data-row-action="menu"` lets
 * `focusPastRow` move focus to the next row's menu when this row goes away.
 */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-row-action="menu"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Icon name="more" />
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={190} align="right">
          <div className="menu" role="menu">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                onClick={() => {
                  // The item goes away with the menu. Focus the menu button first, so a modal the
                  // item opens returns focus there when it closes.
                  anchor.focus();
                  setAnchor(null);
                  item.onSelect();
                }}
              >
                {item.icon ? <Icon name={item.icon} size={16} /> : <span className="manage-menu-gap" />}
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** Status pill for active and archived rows. `label` replaces the text, as in Disabled for accounts. */
export function StatusBadge({ archived, label }: { archived: boolean; label?: string }) {
  return <span className={`manage-status${archived ? ' is-archived' : ''}`}>{label ?? (archived ? 'Archived' : 'Active')}</span>;
}

export type StatusFilter = 'active' | 'archived' | 'all';

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

export function matchesStatus(archived: boolean, filter: StatusFilter): boolean {
  return filter === 'all' || (filter === 'archived') === archived;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
