import { useRef, useState } from 'react';
import type { AdminAccount } from '../../api/types.ts';
import { closeModalThen } from '../../components/Overlay.tsx';
import type { Settings } from '../../lib/settings.ts';
import { focusPastRow, rowAction } from '../manage/rowFocus.ts';
import { SettingsCard } from '../manage/settings/SettingsCard.tsx';
import { DeleteUserModal } from './DeleteUserModal.tsx';
import { NewLink } from './NewLink.tsx';
import { UserRow } from './UserRow.tsx';

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
    <SettingsCard
      id="users"
      title="Users"
      titleRef={title}
      intro="Every account on this server. Disabling signs the account out and blocks it until you enable it again."
    >
      <div className="table-wrap">
        <table className="table admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Status</th>
              <th className="num">Created</th>
              <th>
                <span className="visually-hidden">Actions</span>
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
          label={`Password reset link for ${reset.email}`}
          copied="Reset link copied"
          onDone={() => {
            (rowAction(tbody.current, reset.id, 'reset') ?? title.current)?.focus();
            setReset(null);
          }}
        >
          <strong>Password reset link for {reset.email} created.</strong> Copy it now: it is shown only once. Send it to
          them; it works once, for 24 hours, and replaces any earlier link. Using it signs the account out of every
          browser and replaces their API token, so apps signed in with the old one must sign in again.
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
