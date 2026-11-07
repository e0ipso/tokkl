import type { RefObject } from 'react';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';

/** A row's More actions menu. Edit and Duplicate need a single entry; Pin and Delete take the whole row. */
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
  /** How many entries the row holds. */
  count: number;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  /** Closes the menu, then runs the item. */
  const item = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Popover anchor={anchor} label="Entry actions" onClose={onClose} width={200} align="right">
      <div className="menu">
        {count === 1 ? (
          <button type="button" onClick={item(onEdit)}>
            <Icon name="edit" size={16} /> Edit
          </button>
        ) : null}
        {count === 1 ? (
          <button type="button" onClick={item(onDuplicate)}>
            <Icon name="copy" size={16} /> Duplicate
          </button>
        ) : null}
        <button type="button" onClick={item(onPin)}>
          <Icon name="star" size={16} /> Pin as favorite
        </button>
        <button type="button" className="danger" onClick={item(onDelete)}>
          <Icon name="trash" size={16} /> Delete{count > 1 ? ` ${count} entries` : ''}
        </button>
      </div>
    </Popover>
  );
}
