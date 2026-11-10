import { useState, type FormEvent } from 'react';
import { adminRequests } from '../../api/admin.ts';
import { stale } from '../../api/keys.ts';
import type { AdminAccount } from '@tokkl/types';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { ConfirmModal } from '../manage/ui.tsx';
import { deleteConfirmError } from './accountChange.ts';
import { t } from '../../i18n/messages.ts';
import { tx } from '../../i18n/rich.ts';

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
    success: t('admin.deleted', { email: user.email }),
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
      title={t('admin.deleteTitle', { email: user.email })}
      confirmLabel={t('admin.deleteAccount')}
      busy={remove.isPending}
      onConfirm={() => confirm()}
      onClose={onClose}
    >
      <p>{t('admin.deleteBody')}</p>
      <p>{t('admin.deleteDisableInstead')}</p>
      <p>{t('admin.deleteExportFirst')}</p>
      <form noValidate onSubmit={confirm}>
        <div className="field">
          <label htmlFor={fields.id('email')}>
            {tx('admin.typeToConfirm', { email: <strong>{user.email}</strong> })}
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
