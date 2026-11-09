import { useQueryClient } from '@tanstack/react-query';
import { useSavePreferences } from '../../../api/account.ts';
import { keys } from '../../../api/keys.ts';
import { useSettings } from '../../../api/settings.ts';
import type { PomodoroLimits, Preferences } from '@tokkl/types';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { useServerDraft } from '../../../components/useServerDraft.ts';
import { today } from '../../../lib/format.ts';
import { AllowNotifications } from '../../../components/AllowNotifications.tsx';
import { DisplayFields, PomodoroDefaults, TimerReminderFields } from './PreferenceFields.tsx';
import {
  changesFrom,
  editableOf,
  isStored,
  numberErrors,
  refusedField,
  toDraft,
  type Editable,
  type NumberKey,
} from './preferencesForm.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { t } from '../../../i18n/messages.ts';

/**
 * The form keeps only what the user typed and has not saved; every other field shows the stored
 * value, so a background refetch, such as after a change on another device, updates the untouched
 * fields and leaves the edits and focus alone. A field changed back to the stored value is no longer
 * an edit, except while a save is pending: the stored value may be about to change, so everything
 * typed then stays an edit until the save settles. Saving sends only the edited fields.
 */
export function PreferencesSection({ prefs, limits }: { prefs: Preferences; limits: PomodoroLimits }) {
  const toast = useToast();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const fields = useFieldErrors<NumberKey>();
  const save = useSavePreferences();
  const form = useServerDraft(toDraft(editableOf(prefs, limits)), save.isPending);
  const { draft, edits, set } = form;
  const dropEditsEqualTo = (stored: Editable) => form.dropEditsMatching((key, value) => isStored(key, value, stored));

  // Only whole numbers go to the server; it checks the allowed values, and its 400 shows on the
  // field it names, as in "Invalid pomodoro_long_break_every: expected ...".
  const submit = () => {
    if (!fields.validate(numberErrors(draft))) return;
    if (!form.hasEdits) {
      toast.show(t('settings.noChanges'));
      return;
    }
    save.mutate(changesFrom(edits), {
      onSuccess: saved => {
        dropEditsEqualTo(editableOf(saved, limits));
        toast.show(t('settings.preferencesSaved'));
      },
      onError: error => {
        // The failed save has rolled the cache back to the stored values.
        const stored = queryClient.getQueryData<Preferences>(keys.preferences);
        if (stored) dropEditsEqualTo(editableOf(stored, limits));
        const refused = refusedField(error.message);
        if (refused) fields.validate([[refused, error.message]]);
        else toast.error(error);
      },
    });
  };

  return (
    <SettingsCard id="preferences" title={t('settings.sectionPreferences')} onSubmit={submit} saving={save.isPending}>
      <DisplayFields draft={draft} set={set} timeZone={settings.timeZone} todayKey={today(settings.timeZone)} />
      <TimerReminderFields draft={draft} set={set} fields={fields} />
      <PomodoroDefaults draft={draft} set={set} fields={fields} limits={limits} />
      <h3 className="settings-subheading" id="notifications-title">
        {t('settings.notifications')}
      </h3>
      <div className="form-grid" role="group" aria-labelledby="notifications-title">
        <AllowNotifications />
      </div>
    </SettingsCard>
  );
}
