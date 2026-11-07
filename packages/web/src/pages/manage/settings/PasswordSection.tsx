import { useState } from 'react';
import { accountRequests } from '../../../api/account.ts';
import { stale } from '../../../api/keys.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { SettingsCard } from './SettingsCard.tsx';

const MIN_LENGTH = 8;

export function PasswordSection() {
  const fields = useFieldErrors<'current' | 'next' | 'confirm'>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useAction<{ current_password: string; password: string }>({
    mutationFn: accountRequests.changePassword,
    // The server replaces the API token with the password, so the API token card must refetch it.
    invalidate: stale.credentials,
    success: 'Password changed. Other browsers were logged out.',
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  const submit = () => {
    const valid = fields.validate([
      ['current', !current && 'Enter your current password'],
      ['next', next.length < MIN_LENGTH && `The new password needs at least ${MIN_LENGTH} characters`],
      ['confirm', next.length >= MIN_LENGTH && next !== confirm && "The new passwords don't match"],
    ]);
    if (!valid) return;
    change.mutate({ current_password: current, password: next });
  };

  return (
    <SettingsCard
      id="password"
      title="Password"
      intro="Changing it logs out every other browser and replaces your API token. This one stays logged in."
      onSubmit={submit}
      saving={change.isPending}
      saveLabel="Change password"
    >
      <div className="form-grid">
        <div className="field field-full">
          <label htmlFor={fields.id('current')}>Current password</label>
          <input
            {...fields.field('current')}
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={event => setCurrent(event.target.value)}
          />
          {fields.message('current')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('next')}>New password</label>
          <input
            {...fields.field('next')}
            type="password"
            value={next}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            onChange={event => setNext(event.target.value)}
          />
          {fields.message('next')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('confirm')}>Repeat new password</label>
          <input
            {...fields.field('confirm')}
            type="password"
            value={confirm}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            onChange={event => setConfirm(event.target.value)}
          />
          {fields.message('confirm')}
        </div>
        <p className="hint field-full">At least {MIN_LENGTH} characters.</p>
      </div>
    </SettingsCard>
  );
}
