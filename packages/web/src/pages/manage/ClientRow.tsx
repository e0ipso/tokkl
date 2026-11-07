import type { Client } from '../../api/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { RowMenu, StatusBadge } from './ui.tsx';
import { t } from '../../i18n/messages.ts';

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
        {client.notes ?? <span className="muted">{t('manage.none')}</span>}
      </td>
      <td className="num">{projects}</td>
      <td>
        <StatusBadge archived={client.archived} />
      </td>
      <td className="manage-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={t('manage.editNamed', { name: client.name })}
          title={t('manage.edit')}
          onClick={onEdit}
        >
          <Icon name="edit" size={16} />
        </button>
        <RowMenu
          label={t('manage.moreActionsFor', { name: client.name })}
          items={[
            client.archived
              ? { label: t('manage.restore'), icon: 'undo', onSelect: onRestore }
              : { label: t('manage.archive'), onSelect: onArchive },
            { label: t('common.delete'), icon: 'trash', danger: true, onSelect: onDelete },
          ]}
        />
      </td>
    </tr>
  );
}
