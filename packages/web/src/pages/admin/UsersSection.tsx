import { useRef, useState, type FormEvent } from 'react';
import { adminRequests, type AccountChange } from '../../api/admin.ts';
import { stale } from '../../api/keys.ts';
import type { AdminAccount, PasswordResetLink } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useAction } from '../../components/useAction.ts';
import { formatDay } from '../../lib/format.ts';
import type { Settings } from '../../lib/settings.ts';
import { focusPastRow, rowAction } from '../manage/rowFocus.ts';
import { SettingsCard } from '../manage/settings/SettingsCard.tsx';
import { ConfirmModal, StatusBadge } from '../manage/ui.tsx';
import { NewLink } from './NewLink.tsx';
import { ROLES, absoluteLink, isUserRole, roleLabel } from './roles.ts';

function UserRow({
  user,
  self,
  settings,
  onDelete,
  onResetLink,
}: {
  user: AdminAccount;
  self: boolean;
  settings: Settings;
  onDelete: (user: AdminAccount) => void;
  onResetLink: (user: AdminAccount, link: string) => void;
}) {
  const fields = useFieldErrors<'role' | 'status'>();
  const disabled = user.disabled_at !== null;

  // A refusal, such as the last-admin 400, shows under the control that sent the change.
  const update = useAction<AccountChange, AdminAccount>({
    mutationFn: change => adminRequests.updateUser(user.id, change),
    invalidate: stale.adminUser,
    success: (updated, body) =>
      'role' in body
        ? `${updated.email} is now ${roleLabel(updated.role)}`
        : `${updated.disabled_at ? 'Disabled' : 'Enabled'} ${updated.email}`,
    onError: (error, body) => fields.validate([['role' in body ? 'role' : 'status', error.message]]),
  });
  const revoke = useAction({
    mutationFn: () => adminRequests.revokeSessions(user.id),
    success: `Signed ${user.email} out of every browser. Their API token still works.`,
  });
  const reset = useAction<void, PasswordResetLink>({
    mutationFn: () => adminRequests.createPasswordReset(user.id),
    onSuccess: created => onResetLink(user, absoluteLink(created.url)),
  });

  // The controls stay enabled while a change is pending, so the one that failed keeps focus and
  // its error can take it; a second change waits for the first.
  const change = (body: AccountChange) => {
    if (update.isPending) return;
    fields.clear('role' in body ? 'role' : 'status');
    update.mutate(body);
  };

  return (
    <tr className={disabled ? 'archived' : undefined} data-id={user.id}>
      <td className="admin-account">
        <span className="admin-account-name">
          {user.fullname || user.email}
          {self ? <span className="muted"> (you)</span> : null}
        </span>
        {user.fullname ? <span className="admin-account-email">{user.email}</span> : null}
      </td>
      <td>
        <select
          {...fields.field('role')}
          aria-label={`Role of ${user.email}`}
          value={user.role}
          onChange={event => {
            const role = event.target.value;
            if (isUserRole(role)) change({ role });
          }}
        >
          {ROLES.map(role => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        {fields.message('role')}
      </td>
      <td>
        <div className="admin-status">
          <StatusBadge archived={disabled} label={disabled ? 'Disabled' : 'Active'} />
          <button
            {...fields.field('status')}
            type="button"
            className="button button-ghost"
            aria-label={`${disabled ? 'Enable' : 'Disable'} ${user.email}`}
            onClick={() => change({ disabled: !disabled })}
          >
            {disabled ? 'Enable' : 'Disable'}
          </button>
        </div>
        {fields.message('status')}
      </td>
      <td className="num admin-date">{formatDay(user.created_at, settings)}</td>
      {/* Plain buttons rather than a RowMenu, so Tab reaches both actions in row order. */}
      <td className="manage-actions">
        {self ? null : (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={`Revoke sessions of ${user.email}`}
              title="Revoke sessions: sign out of every browser"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              <Icon name="logout" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Reset password of ${user.email}`}
              data-row-action="reset"
              title="Reset password: create a one-time link to set a new password"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              <Icon name="key" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${user.email}`}
              data-row-action="delete"
              title="Delete account"
              onClick={() => onDelete(user)}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminAccount;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const fields = useFieldErrors<'email'>();
  const [email, setEmail] = useState('');
  const remove = useAction<string>({
    mutationFn: typed => adminRequests.deleteUser(user.id, typed),
    invalidate: stale.adminUsers,
    success: `Deleted ${user.email}`,
    onSuccess: onDeleted,
    onError: error => fields.validate([['email', error.message]]),
  });

  const confirm = (event?: FormEvent) => {
    event?.preventDefault();
    const typed = email.trim();
    if (
      !fields.validate([
        ['email', typed.toLowerCase() !== user.email.toLowerCase() && "Type the account's email to confirm"],
      ])
    )
      return;
    remove.mutate(typed);
  };

  return (
    <ConfirmModal
      title={`Delete ${user.email}?`}
      confirmLabel="Delete account"
      busy={remove.isPending}
      onConfirm={() => confirm()}
      onClose={onClose}
    >
      <p>
        This deletes the account and its workspace, with every time entry, project, client and tag in it. It cannot be
        undone.
      </p>
      <p>To keep the data, disable the account instead. A disabled account can be enabled again.</p>
      <p>Ask them to export their data first, from Settings, Data.</p>
      <form noValidate onSubmit={confirm}>
        <div className="field">
          <label htmlFor={fields.id('email')}>
            Type <strong>{user.email}</strong> to confirm
          </label>
          <input
            {...fields.field('email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          {fields.message('email')}
        </div>
      </form>
    </ConfirmModal>
  );
}

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
            focusPastRow(tbody.current, deleting.id, 'delete', title.current);
            setDeleting(null);
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
