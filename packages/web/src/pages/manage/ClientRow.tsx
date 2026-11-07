import type { Client } from '../../api/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { RowMenu, StatusBadge } from './ui.tsx';

/** One client in the list, with Edit and a menu that archives, restores or deletes it. */
export function ClientRow({
  client,
  projects,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  client: Client;
  /** How many projects the client has. */
  projects: number;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <tr data-id={client.id} className={client.archived ? 'archived' : undefined}>
      <td>
        <button type="button" className="manage-name-button" onClick={onEdit}>
          {client.name}
        </button>
      </td>
      <td className="manage-notes" title={client.notes ?? undefined}>
        {client.notes ?? <span className="muted">None</span>}
      </td>
      <td className="num">{projects}</td>
      <td>
        <StatusBadge archived={client.archived} />
      </td>
      <td className="manage-actions">
        <button type="button" className="icon-button" aria-label={`Edit ${client.name}`} title="Edit" onClick={onEdit}>
          <Icon name="edit" size={16} />
        </button>
        <RowMenu
          label={`More actions for ${client.name}`}
          items={[
            client.archived
              ? { label: 'Restore', icon: 'undo', onSelect: onRestore }
              : { label: 'Archive', onSelect: onArchive },
            { label: 'Delete', icon: 'trash', danger: true, onSelect: onDelete },
          ]}
        />
      </td>
    </tr>
  );
}
