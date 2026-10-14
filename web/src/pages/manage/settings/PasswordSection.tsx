import { useState } from 'react';
import { api } from '../../../api/client.ts';
import { useToast } from '../../../components/Toast.tsx';
import { useAction, V9 } from '../queries.ts';
import { SettingsCard } from './SettingsCard.tsx';

const MIN_LENGTH = 8;

export function PasswordSection() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useAction<{ current_password: string; password: string }>({
    mutationFn: (body) => api.put(`${V9}/me`, body),
    success: 'Password changed. Other browsers were logged out.',
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  const submit = () => {
    if (!current) return toast.show('Enter your current password', { kind: 'error' });
    if (next.length < MIN_LENGTH) return toast.show(`The new password needs at least ${MIN_LENGTH} characters`, { kind: 'error' });
    if (next !== confirm) return toast.show("The new passwords don't match", { kind: 'error' });
    change.mutate({ current_password: current, password: next });
  };

  return (
    <SettingsCard
      id="password"
      title="Password"
      intro="Changing it logs out every other browser. This one stays logged in. API tokens keep working."
      onSubmit={submit}
      saving={change.isPending}
      saveLabel="Change password"
    >
      <div className="form-grid">
        <label className="field field-full">
          <span>Current password</span>
          <input type="password" value={current} autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={next}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Repeat new password</span>
          <input
            type="password"
            value={confirm}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        <p className="hint field-full">At least {MIN_LENGTH} characters.</p>
      </div>
    </SettingsCard>
  );
}
