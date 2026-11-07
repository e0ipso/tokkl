import { useQueryClient } from '@tanstack/react-query';
import { adminRequests } from '../../api/admin.ts';
import { keys, stale } from '../../api/keys.ts';
import type { InstanceSettings } from '../../api/types.ts';
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

type SettingsKey = keyof InstanceSettings;
type SettingsDraft = Record<SettingsKey, string>;

function toDraft(settings: InstanceSettings): SettingsDraft {
  return {
    session_days: String(settings.session_days),
    invite_days: String(settings.invite_days),
    time_resolution_minutes: String(settings.time_resolution_minutes),
  };
}

/** Whether the typed `value` is the number `stored` holds for `key`. */
const holds = (stored: InstanceSettings) => (key: SettingsKey, value: string) => Number(value.trim()) === stored[key];

/**
 * The form keeps only what the admin typed and has not saved (see useServerDraft), so a background
 * refetch, such as after another admin's change, updates the untouched fields. Saving sends only
 * the edited fields, so it never writes back a value the admin did not change.
 */
export function InstanceSettingsSection({ server }: { server: InstanceSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fields = useFieldErrors<SettingsKey>();

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
      const field = SETTING_FIELDS.find(({ key }) => error.message.includes(key));
      if (field) fields.validate([[field.key, error.message]]);
      else toast.error(error);
    },
  });
  const form = useServerDraft(toDraft(server), save.isPending);
  const { draft, edits } = form;

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
      </div>
    </SettingsCard>
  );
}
