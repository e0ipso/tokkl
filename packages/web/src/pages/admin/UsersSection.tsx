import { useRef, useState } from 'react';
import type { AdminAccount } from '@tokkl/types';
import { closeModalThen } from '../../components/Overlay.tsx';
import type { Settings } from '../../lib/settings.ts';
import { focusPastRow, rowAction } from '../manage/rowFocus.ts';
import { SettingsCard } from '../manage/settings/SettingsCard.tsx';
import { DeleteUserModal } from './DeleteUserModal.tsx';
import { NewLink } from './NewLink.tsx';
import { UserRow } from './UserRow.tsx';
import { t } from '../../i18n/messages.ts';

/** Every account on the server, with role, status, password reset and delete. */
export function UsersSection({
  users,
  meId,
  settings,
}: {
  users: AdminAccount[];
  meId: number | undefined;
  settings: Settings;
}) {
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [reset, setReset] = useState<{ id: number; email: string; link: string } | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <SettingsCard id="users" title={t('admin.sectionUsers')} titleRef={title} intro={t('admin.usersIntro')}>
      <div className="table-wrap">
        <table className="table admin-table">
          <thead>
            <tr>
              <th>{t('admin.account')}</th>
              <th>{t('admin.role')}</th>
              <th>{t('admin.status')}</th>
              <th className="num">{t('admin.created')}</th>
              <th>
                <span className="visually-hidden">{t('admin.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody ref={tbody}>
            {users.map(user => (
              <UserRow
                key={user.id}
                user={user}
                self={user.id === meId}
                settings={settings}
                onDelete={setDeleting}
                onResetLink={(account, link) => setReset({ id: account.id, email: account.email, link })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {reset ? (
        <NewLink
          key={reset.link}
          link={reset.link}
          label={t('admin.resetLinkLabel', { email: reset.email })}
          copied={t('admin.resetLinkCopied')}
          onDone={() => {
            (rowAction(tbody.current, reset.id, 'reset') ?? title.current)?.focus();
            setReset(null);
          }}
        >
          <strong>{t('admin.resetLinkCreated', { email: reset.email })}</strong> {t('admin.resetLinkHelp')}
        </NewLink>
      ) : null}
      {deleting ? (
        <DeleteUserModal
          key={deleting.id}
          user={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // The modal had focus; the row that opened it goes away once the list refetches.
            closeModalThen(
              () => setDeleting(null),
              () => focusPastRow(tbody.current, deleting.id, 'delete', title.current),
            );
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
