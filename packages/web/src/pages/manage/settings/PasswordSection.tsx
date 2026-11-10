import { useState } from 'react';
import { accountRequests } from '../../../api/account.ts';
import { stale } from '../../../api/keys.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { t } from '../../../i18n/messages.ts';

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
    success: t('settings.passwordChanged'),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  const submit = () => {
    const valid = fields.validate([
      ['current', !current && t('settings.enterCurrentPassword')],
      ['next', next.length < MIN_LENGTH && t('settings.passwordTooShort', { count: MIN_LENGTH })],
      ['confirm', next.length >= MIN_LENGTH && next !== confirm && t('settings.passwordsDontMatch')],
    ]);
    if (!valid) return;
    change.mutate({ current_password: current, password: next });
  };

  return (
    <SettingsCard
      id="password"
      title={t('settings.sectionPassword')}
      intro={t('settings.passwordIntro')}
      onSubmit={submit}
      saving={change.isPending}
      saveLabel={t('settings.changePassword')}
    >
      <div className="form-grid">
        <div className="field field-full">
          <label htmlFor={fields.id('current')}>{t('settings.currentPassword')}</label>
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
          <label htmlFor={fields.id('next')}>{t('settings.newPassword')}</label>
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
          <label htmlFor={fields.id('confirm')}>{t('settings.repeatNewPassword')}</label>
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
        <p className="hint field-full">{t('settings.passwordMinimum', { count: MIN_LENGTH })}</p>
      </div>
    </SettingsCard>
  );
}
