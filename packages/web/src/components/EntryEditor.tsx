import { useRef, useState } from 'react';
import {
  useCreateEntry,
  useDeleteEntry,
  useRestoreEntry,
  useUpdateEntry,
  useUpdateRunningEntry,
} from '../api/entries.ts';
import { useProjects } from '../api/projects.ts';
import { useSettings } from '../api/settings.ts';
import type { TimeEntry } from '../api/types.ts';
import { useNow } from '../lib/clock.ts';
import { duplicateInput } from '../lib/duplicateEntry.ts';
import { localDay } from '../lib/entryTime.ts';
import { DurationField } from './DurationField.tsx';
import { EntrySplitField } from './EntrySplitField.tsx';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { Modal } from './Overlay.tsx';
import { ProjectLabel } from './ProjectLabel.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { useToast } from './Toast.tsx';
import { useExclusive } from './useExclusive.ts';
import { draftOf, projectChanges, type EntryDraft } from './useEntryFields.ts';
import { useEntryTimes, type TimeFieldKey } from './useEntryTimes.ts';
import { t } from '../i18n/messages.ts';

function isStopped(entry: TimeEntry): entry is TimeEntry & { stop: string } {
  return entry.stop !== null;
}

/**
 * Full editor for one entry: every field, plus duplicate, split and delete. One of Save, Duplicate,
 * Split and Delete runs at a time, and the others are disabled until it is done, so a double click
 * never saves twice or duplicates an entry that is being deleted.
 */
export function EntryEditor({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const settings = useSettings();
  const now = useNow(entry.stop ? 60_000 : 1000);
  const times = useEntryTimes(entry, settings, now);
  const { running } = times;
  const [draft, setDraft] = useState<EntryDraft>(() => draftOf(entry));
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
  const { data: projects = [] } = useProjects();
  const update = useUpdateEntry();
  const updateRunning = useUpdateRunningEntry();
  const create = useCreateEntry();
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const toast = useToast();
  const fields = useFieldErrors<TimeFieldKey>();
  const actions = useExclusive();
  const edit = (changes: Partial<EntryDraft>) => setDraft(current => ({ ...current, ...changes }));

  const save = () =>
    actions.run(async () => {
      const timeChanges = times.changes(fields.validate);
      if (!timeChanges) return;
      try {
        // The running entry saves through the timer, which takes its labels and a moved start.
        if (running) await updateRunning.mutateAsync({ id: entry.id, ...draft, start: timeChanges.start });
        else await update.mutateAsync({ id: entry.id, ...draft, ...timeChanges });
        onClose();
      } catch (error) {
        toast.error(error);
      }
    });

  const duplicate = () =>
    actions.run(async () => {
      if (!entry.stop) return;
      try {
        await create.mutateAsync(duplicateInput(entry, settings.timeZone));
        toast.show(t('entries.duplicated'));
        onClose();
      } catch (error) {
        toast.error(error);
      }
    });

  const destroy = () =>
    actions.run(async () => {
      try {
        await remove.mutateAsync(entry.id);
        toast.show(t('entries.deleted'), {
          action: { label: t('common.undo'), run: () => restore.mutate(entry.id) },
        });
        onClose();
      } catch (error) {
        toast.error(error);
      }
    });

  const project = projects.find(p => p.id === draft.project_id);
  const rangeStop = times.range?.stop ?? null;
  return (
    <Modal
      title={running ? t('entries.editRunning') : t('entries.editEntry')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button button-danger-ghost"
            onClick={() => void destroy()}
            disabled={actions.busy}
          >
            <Icon name="trash" size={16} /> {t('common.delete')}
          </button>
          <span className="spacer" />
          {!running ? (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void duplicate()}
              disabled={actions.busy}
            >
              <Icon name="copy" size={16} /> {t('entries.duplicate')}
            </button>
          ) : null}
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={actions.busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field field-full">
          <span>{t('entries.description')}</span>
          <input
            value={draft.description}
            onChange={event => edit({ description: event.target.value })}
            maxLength={3000}
          />
        </label>
        <div className="field">
          <span>{t('entries.project')}</span>
          <button ref={projectButton} type="button" className="select-button" onClick={() => setPicker('project')}>
            {draft.project_id ? (
              <ProjectLabel projectId={draft.project_id} taskId={draft.task_id} />
            ) : (
              <span className="muted">{t('entries.noProject')}</span>
            )}
          </button>
        </div>
        <div className="field">
          <span>{t('entries.tags')}</span>
          <button ref={tagButton} type="button" className="select-button" onClick={() => setPicker('tags')}>
            {draft.tags.length ? draft.tags.join(', ') : <span className="muted">{t('entries.noTags')}</span>}
          </button>
        </div>
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={draft.billable}
            onChange={event => edit({ billable: event.target.checked })}
          />
          <span>{project?.billable ? t('entries.billableProjectDefault') : t('entries.billable')}</span>
        </label>
        {!running ? (
          <label className="manual-switch field-full">
            <input
              type="checkbox"
              role="switch"
              checked={times.noTimes}
              onChange={event => {
                times.toggleNoTimes(event.target.checked);
                (['start', 'end', 'duration'] as const).forEach(fields.clear);
              }}
            />
            {t('entries.noTimes')}
          </label>
        ) : null}
        <label className="field">
          <span>{t('entries.date')}</span>
          <input
            type="date"
            value={times.day}
            onChange={event => event.target.value && times.setDay(event.target.value)}
          />
        </label>
        {times.noTimes ? (
          <div className="field">
            <label htmlFor={fields.id('duration')}>{t('entries.duration')}</label>
            <DurationField
              format={settings.durationFormat}
              seconds={times.noTimeLength}
              onCommit={times.setNoTimeSeconds}
              inputProps={fields.field('duration')}
            />
            {fields.message('duration')}
          </div>
        ) : (
          <div className="field">
            <label htmlFor={fields.id('start')}>{t('entries.start')}</label>
            <input
              {...fields.field('start')}
              value={times.startText}
              onChange={event => times.setStartText(event.target.value)}
              onBlur={times.syncDuration}
            />
            {fields.message('start')}
          </div>
        )}
        {!running && !times.noTimes ? (
          <>
            <div className="field">
              <label htmlFor={fields.id('end')}>{t('entries.end')}</label>
              <input
                {...fields.field('end')}
                value={times.endText}
                onChange={event => times.setEndText(event.target.value)}
                onBlur={times.syncDuration}
              />
              {fields.message('end')}
            </div>
            <div className="field">
              <label htmlFor={fields.id('duration')}>{t('entries.duration')}</label>
              <input
                {...fields.field('duration')}
                value={times.durationText}
                onChange={event => times.setDurationText(event.target.value)}
                onBlur={times.applyDuration}
              />
              {fields.message('duration')}
            </div>
          </>
        ) : null}
        {rangeStop && localDay(rangeStop, settings.timeZone) !== times.day ? (
          <p className="field-full hint">{t('entries.endsNextDay', { day: localDay(rangeStop, settings.timeZone) })}</p>
        ) : null}
        {isStopped(entry) && !times.noTimes && !entry.all_day ? (
          <EntrySplitField entry={entry} settings={settings} actions={actions} onSplit={onClose} />
        ) : null}
        <button type="submit" hidden />
      </form>
      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectButton}
          projectId={draft.project_id}
          taskId={draft.task_id}
          onChange={(pid, tid) => edit(projectChanges(draft, projects, pid, tid))}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagButton}
          value={draft.tags}
          onChange={tags => edit({ tags })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </Modal>
  );
}
