import { useState, type FormEvent } from 'react';
import { adminRequests } from '../../api/admin.ts';
import { stale } from '../../api/keys.ts';
import type { AdminAccount } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { ConfirmModal } from '../manage/ui.tsx';
import { deleteConfirmError } from './accountChange.ts';

/** Deletes an account once the admin types its email. */
export function DeleteUserModal({
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
    if (!fields.validate([['email', deleteConfirmError(email, user.email)]])) return;
    remove.mutate(email.trim());
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
