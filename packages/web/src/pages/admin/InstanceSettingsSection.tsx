import { useQueryClient } from '@tanstack/react-query';
import { adminRequests } from '../../api/admin.ts';
import { keys, stale } from '../../api/keys.ts';
import type { InstanceSettings } from '@tokkl/types';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAction } from '../../components/useAction.ts';
import { useServerDraft } from '../../components/useServerDraft.ts';
import { SettingsCard } from '../manage/settings/SettingsCard.tsx';
import { t, type MessageKey } from '../../i18n/messages.ts';

const SETTING_FIELDS = [
  {
    key: 'session_days',
    unit: 'admin.unitDays',
    label: 'admin.sessionLength',
    hint: 'admin.sessionLengthHint',
  },
  {
    key: 'invite_days',
    unit: 'admin.unitDays',
    label: 'admin.inviteLifetime',
    hint: 'admin.inviteLifetimeHint',
  },
  {
    key: 'time_resolution_minutes',
    unit: 'admin.unitMinutes',
    label: 'admin.timeResolution',
    hint: 'admin.timeResolutionHint',
  },
] as const satisfies ReadonlyArray<{
  key: keyof InstanceSettings;
  unit: MessageKey;
  label: MessageKey;
  hint: MessageKey;
}>;

type NumberKey = (typeof SETTING_FIELDS)[number]['key'];
type SettingsKey = NumberKey | 'signup_enabled';
type SettingsDraft = Record<NumberKey, string> & Pick<InstanceSettings, 'signup_enabled'>;

function toDraft(settings: InstanceSettings): SettingsDraft {
  return {
    session_days: String(settings.session_days),
    invite_days: String(settings.invite_days),
    time_resolution_minutes: String(settings.time_resolution_minutes),
    signup_enabled: settings.signup_enabled,
  };
}

const holds = (stored: InstanceSettings) => (key: SettingsKey, value: string | boolean) =>
  (typeof value === 'boolean' ? value : Number(value.trim())) === stored[key];

/** Keeps only unsaved edits (see useServerDraft), so a refetch updates untouched fields and saves send only edits. */
export function InstanceSettingsSection({ server }: { server: InstanceSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fields = useFieldErrors<SettingsKey>();

  // Only a checked reply goes into the cache.
  const save = useAction<Partial<InstanceSettings>, InstanceSettings>({
    mutationFn: adminRequests.saveSettings,
    invalidate: stale.adminSettings,
    success: t('admin.instanceSaved'),
    onSuccess: saved => {
      queryClient.setQueryData(keys.adminSettings, saved);
      form.dropEditsMatching(holds(saved));
    },
    onError: error => {
      const current = queryClient.getQueryData<InstanceSettings>(keys.adminSettings);
      if (current) form.dropEditsMatching(holds(current));
      // The server names the setting it refused, as in "Invalid invite_days: ...".
      const field = [...SETTING_FIELDS.map(({ key }) => key), 'signup_enabled' as const].find(key =>
        error.message.includes(key),
      );
      if (field) fields.validate([[field, error.message]]);
      else toast.error(error);
    },
  });
  const form = useServerDraft(toDraft(server), save.isPending);
  const { draft, edits } = form;
  const signupField = fields.field('signup_enabled');
  const signupHintId = `${fields.id('signup_enabled')}-hint`;

  // Only whole numbers go to the server; it checks the allowed values and its 400 shows on the field.
  const submit = () => {
    const valid = fields.validate(
      SETTING_FIELDS.map(
        ({ key, unit }) =>
          [
            key,
            (draft[key].trim() === '' || !Number.isInteger(Number(draft[key].trim()))) &&
              t('admin.wholeNumber', { unit: t(unit) }),
          ] as const,
      ),
    );
    if (!valid) return;
    const changes: Partial<InstanceSettings> = {};
    for (const { key } of SETTING_FIELDS) {
      const value = edits[key];
      if (value !== undefined) changes[key] = Number(value.trim());
    }
    if (edits.signup_enabled !== undefined) changes.signup_enabled = edits.signup_enabled;
    if (Object.keys(changes).length > 0) save.mutate(changes);
    else toast.show(t('admin.noChanges'));
  };

  return (
    <SettingsCard id="instance" title={t('admin.sectionInstance')} onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        {SETTING_FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="field">
            <label htmlFor={fields.id(key)}>{t(label)}</label>
            <input
              {...fields.field(key)}
              type="number"
              inputMode="numeric"
              value={draft[key]}
              onChange={event => form.set(key, event.target.value)}
            />
            {fields.message(key)}
            <p className="hint">{t(hint)}</p>
          </div>
        ))}
        <div className="field field-full">
          <label className="field checkbox-field">
            <input
              {...signupField}
              type="checkbox"
              checked={draft.signup_enabled}
              disabled={!server.mail_configured.configured}
              aria-describedby={[signupField['aria-describedby'], signupHintId].filter(Boolean).join(' ')}
              onChange={event => form.set('signup_enabled', event.target.checked)}
            />
            <span>{t('admin.allowSignup')}</span>
          </label>
          {fields.message('signup_enabled')}
          <p id={signupHintId} className="hint">
            {server.mail_configured.configured
              ? t('admin.signupHint')
              : t('admin.signupMissingMail', { missing: server.mail_configured.missing.join(', ') })}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}
