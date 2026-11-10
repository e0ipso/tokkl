import type { RefObject } from 'react';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { t } from '../i18n/messages.ts';

/** Edit and Duplicate need a single entry; Pin and Delete take the whole row. */
export function EntryLineMenu({
  anchor,
  count,
  onClose,
  onEdit,
  onDuplicate,
  onPin,
  onDelete,
}: {
  anchor: RefObject<HTMLElement | null>;
  count: number;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const item = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Popover anchor={anchor} label={t('entries.menuLabel')} onClose={onClose} width={200} align="right">
      <div className="menu">
        {count === 1 ? (
          <button type="button" onClick={item(onEdit)}>
            <Icon name="edit" size={16} /> {t('entries.edit')}
          </button>
        ) : null}
        {count === 1 ? (
          <button type="button" onClick={item(onDuplicate)}>
            <Icon name="copy" size={16} /> {t('entries.duplicate')}
          </button>
        ) : null}
        <button type="button" onClick={item(onPin)}>
          <Icon name="star" size={16} /> {t('entries.pin')}
        </button>
        <button type="button" className="danger" onClick={item(onDelete)}>
          <Icon name="trash" size={16} /> {count > 1 ? t('entries.deleteCount', { count }) : t('common.delete')}
        </button>
      </div>
    </Popover>
  );
}
