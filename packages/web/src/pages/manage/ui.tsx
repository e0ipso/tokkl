import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Modal, Popover } from '../../components/Overlay.tsx';
import { t } from '../../i18n/messages.ts';

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onClose,
  extraActions,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** For choices like "delete entries too". */
  extraActions?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
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
      }
    >
      <div className="manage-confirm">{children}</div>
    </Modal>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} role="group" aria-label={label}>
      {options.map(option => (
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

/** The accessible name defaults to the placeholder. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label = placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  return (
    <label className="search-box">
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
}

/** Its `data-row-action="menu"` lets `focusPastRow` move focus to the next row's menu. */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-row-action="menu"
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <Popover
          anchor={button}
          label={t('manage.rowActions')}
          onClose={() => setOpen(false)}
          width={190}
          align="right"
        >
          <div className="menu" role="menu">
            {items.map(item => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                onClick={() => {
                  // Focus the menu button first, so a modal the item opens returns focus there.
                  button.current?.focus();
                  setOpen(false);
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

/** `label` replaces the text, as in Disabled for accounts. */
export function StatusBadge({ archived, label }: { archived: boolean; label?: string }) {
  return (
    <span className={`manage-status${archived ? ' is-archived' : ''}`}>
      {label ?? (archived ? t('manage.statusArchived') : t('manage.statusActive'))}
    </span>
  );
}
