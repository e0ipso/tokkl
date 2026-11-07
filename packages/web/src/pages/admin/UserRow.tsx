import { adminRequests, type AccountChange } from '../../api/admin.ts';
import { stale } from '../../api/keys.ts';
import type { AdminAccount, PasswordResetLink } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useAction } from '../../components/useAction.ts';
import { formatDay } from '../../lib/format.ts';
import type { Settings } from '../../lib/settings.ts';
import { StatusBadge } from '../manage/ui.tsx';
import { changeField, changeMessage } from './accountChange.ts';
import { ROLES, absoluteLink, isUserRole } from './roles.ts';

/** One account: its role, status and the admin actions on it. */
export function UserRow({
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
    success: changeMessage,
    onError: (error, body) => fields.validate([[changeField(body), error.message]]),
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
    fields.clear(changeField(body));
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
