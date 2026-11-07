import { useId, useRef, useState } from 'react';
import { formatDuration } from '@tokkl/common/duration';
import { useCreateEntry } from '../api/entries.ts';
import type { TimeEntry } from '../api/types.ts';
import { noTimeDuration } from '../lib/noTimeDuration.ts';
import { useSettings } from '../api/settings.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { EntryFields } from './EntryFields.tsx';
import { useFieldErrors } from './FieldError.tsx';
import { Modal } from './Overlay.tsx';
import { useToast } from './Toast.tsx';
import { EMPTY_DRAFT, type EntryDraft } from './useEntryFields.ts';
import { t } from '../i18n/messages.ts';

/** A calendar draft for a no-time entry, independent of the timer bar and saved-entry editor. */
export function AllDayEntryDialog({
  date,
  recentEntries,
  onClose,
}: {
  date: string;
  recentEntries: TimeEntry[];
  onClose: () => void;
}) {
  const settings = useSettings();
  const create = useCreateEntry();
  const toast = useToast();
  const formId = useId();
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const [day, setDay] = useState(date);
  const [durationText, setDurationText] = useState('');
  const fields = useFieldErrors<'duration'>();
  // React may not have rendered the pending mutation before another submit arrives.
  const submitting = useRef(false);

  const save = async () => {
    if (submitting.current || create.isPending) return;
    const { seconds, error } = noTimeDuration(durationText, settings.timeResolution);
    if (!fields.validate([['duration', error]]) || seconds === null) return;
    submitting.current = true;
    try {
      // TanStack skips a call's own callbacks once its component is gone, so a dismissed draft's
      // pending save cannot close a newer dialog. The toast still says what was added.
      const saved = await create.mutateAsync(
        { ...draft, all_day: true, start_date: day, duration: seconds },
        { onSuccess: () => onClose() },
      );
      toast.show(t('entries.added', { duration: formatDuration(entrySeconds(saved, new Date())) }));
    } catch (error) {
      toast.error(error);
    } finally {
      submitting.current = false;
    }
  };

  return (
    // Not modal: Tab can leave the draft for another day's add button, which replaces it.
    <Modal
      title={t('calendar.addAllDayTitle')}
      modal={false}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={create.isPending}>
            {create.isPending ? t('calendar.adding') : t('calendar.addEntry')}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="form-grid all-day-entry-form"
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field-full all-day-entry-details">
          <EntryFields
            draft={draft}
            recentEntries={recentEntries}
            placeholder={t('timer.placeholderManual')}
            onType={description => setDraft(current => ({ ...current, description }))}
            onEdit={changes => setDraft(current => ({ ...current, ...changes }))}
            onDescriptionBlur={() => {}}
            onEnter={() => {
              void save();
            }}
            readOnly={create.isPending}
          />
        </div>
        <label className="manual-switch field-full">
          <input type="checkbox" role="switch" checked disabled />
          {t('entries.noTimes')}
        </label>
        <label className="field">
          <span>{t('entries.date')}</span>
          <input
            type="date"
            value={day}
            disabled={create.isPending}
            onChange={event => event.target.value && setDay(event.target.value)}
          />
        </label>
        <div className="field">
          <label htmlFor={fields.id('duration')}>{t('entries.duration')}</label>
          <input
            {...fields.field('duration')}
            value={durationText}
            placeholder={t('calendar.durationPlaceholder')}
            disabled={create.isPending}
            onChange={event => setDurationText(event.target.value)}
          />
          {fields.message('duration')}
        </div>
      </form>
    </Modal>
  );
}
