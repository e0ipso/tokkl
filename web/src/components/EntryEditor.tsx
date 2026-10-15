import { useMemo, useRef, useState } from 'react';
import { useCreateEntry, useDeleteEntry, useProjects, useRestoreEntry, useUpdateEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { formatDuration, parseDuration } from '../../../shared/duration.ts';
import { parseTimeOfDay } from '../../../shared/timeOfDay.ts';
import { addDays } from '../../../shared/time.ts';
import { instantAt, localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { entrySeconds, formatTime, minutesOfDay, useNow, useSettings } from '../lib/settings.ts';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { Modal } from './Overlay.tsx';
import { ProjectLabel, ProjectPicker, TagPicker } from './Pickers.tsx';
import { useToast } from './Toast.tsx';

/** Full editor for one entry: every field, plus duplicate, split and delete. */
export function EntryEditor({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const settings = useSettings();
  const now = useNow(entry.stop ? 60_000 : 1000);
  const running = entry.stop === null;
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.project_id);
  const [taskId, setTaskId] = useState(entry.task_id);
  const [tags, setTags] = useState(entry.tags);
  const [billable, setBillable] = useState(entry.billable);
  const [day, setDay] = useState(localDay(entry.start, settings.timeZone));
  const [startText, setStartText] = useState(formatTime(entry.start, settings));
  const [endText, setEndText] = useState(entry.stop ? formatTime(entry.stop, settings) : '');
  const [durationText, setDurationText] = useState(formatDuration(entrySeconds(entry, now)));
  // What the fields showed when the editor opened, and the duration last derived from start/end.
  // Times are typed to the minute, so unchanged fields must not be sent back: that would drop the
  // seconds, or pick the wrong hour when a DST change makes a wall time ambiguous.
  const [initial] = useState(() => ({
    day: localDay(entry.start, settings.timeZone),
    start: formatTime(entry.start, settings),
    end: entry.stop ? formatTime(entry.stop, settings) : '',
  }));
  const [syncedDuration, setSyncedDuration] = useState(durationText);
  const [splitText, setSplitText] = useState('');
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
  const { data: projects = [] } = useProjects();
  const update = useUpdateEntry();
  const create = useCreateEntry();
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const toast = useToast();
  const fields = useFieldErrors<'start' | 'end' | 'duration' | 'split'>();

  const timeOptions = { timeZone: settings.timeZone, twelveHour: settings.twelveHour, nowMinutes: minutesOfDay(now, settings.timeZone) };
  const range = useMemo(() => {
    if (running) {
      const minutes = parseTimeOfDay(startText, { twelveHour: settings.twelveHour, reference: timeOptions.nowMinutes });
      return minutes === null ? null : { start: instantAt(day, minutes, settings.timeZone), stop: null };
    }
    return resolveRange(day, startText, endText, timeOptions);
  }, [day, startText, endText, running, settings.timeZone, settings.twelveHour, timeOptions.nowMinutes]);

  const startChanged = day !== initial.day || startText !== initial.start;
  const endChanged = day !== initial.day || endText !== initial.end;
  const durationChanged = durationText !== syncedDuration;

  const syncDuration = (next: { start: Date; stop: Date | null } | null) => {
    if (!next?.stop || (!startChanged && !endChanged)) return;
    const text = formatDuration((next.stop.getTime() - next.start.getTime()) / 1000);
    setDurationText(text);
    setSyncedDuration(text);
  };

  const applyDuration = () => {
    if (!durationChanged) return;
    const seconds = parseDuration(durationText);
    if (seconds === null || !range) return;
    const start = startChanged ? range.start : new Date(entry.start);
    setEndText(formatTime(new Date(start.getTime() + seconds * 1000), settings));
  };

  const save = async () => {
    const unreadable = !range && (running ? 'start' : unreadableTime(startText, timeOptions));
    const seconds = !running && durationChanged ? parseDuration(durationText) : null;
    const timesMessage = 'Check the start and end times';
    const valid = fields.validate([
      ['start', unreadable === 'start' && timesMessage],
      ['end', unreadable === 'end' && timesMessage],
      ['duration', !running && durationChanged && seconds === null && 'Check the duration'],
    ]);
    if (!valid || !range) return;
    const times: { start?: string; stop?: string } = {};
    const start = startChanged ? range.start : new Date(entry.start);
    if (startChanged) times.start = start.toISOString();
    if (!running) {
      if (seconds !== null) times.stop = new Date(start.getTime() + seconds * 1000).toISOString();
      else if (endChanged && range.stop) times.stop = range.stop.toISOString();
    }
    try {
      await update.mutateAsync({
        id: entry.id, description, project_id: projectId, task_id: taskId, tags, billable, ...times,
      });
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };

  const duplicate = async () => {
    if (!entry.stop) return;
    try {
      await create.mutateAsync({
        description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags,
        billable: entry.billable, start: entry.start, stop: entry.stop,
      });
      toast.show('Entry duplicated');
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };

  const split = async () => {
    if (!entry.stop) return;
    const minutes = parseTimeOfDay(splitText, { twelveHour: settings.twelveHour, reference: minutesOfDay(entry.start, settings.timeZone) });
    if (minutes === null) return void fields.validate([['split', 'Enter a split time like 10:30']]);
    const startDay = localDay(entry.start, settings.timeZone);
    let at = instantAt(startDay, minutes, settings.timeZone);
    // Overnight: the same clock time on the next calendar day. Adding 24 hours would be off by the
    // DST shift when the clocks change that night.
    if (at <= new Date(entry.start)) at = instantAt(addDays(startDay, 1), minutes, settings.timeZone);
    const outside = at <= new Date(entry.start) || at >= new Date(entry.stop);
    if (!fields.validate([['split', outside && 'The split time must fall inside the entry']])) return;
    try {
      // Create the second half first: if that fails, the original entry is untouched.
      const second = await create.mutateAsync({
        description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags,
        billable: entry.billable, start: at.toISOString(), stop: entry.stop,
      });
      try {
        await update.mutateAsync({ id: entry.id, stop: at.toISOString() });
      } catch (error) {
        await remove.mutateAsync(second.id).catch(() => undefined);
        throw error;
      }
      toast.show('Entry split in two');
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };

  const destroy = async () => {
    try {
      await remove.mutateAsync(entry.id);
      toast.show('Entry deleted', { action: { label: 'Undo', run: () => restore.mutate(entry.id) } });
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };

  const project = projects.find((p) => p.id === projectId);
  return (
    <Modal
      title={running ? 'Edit running entry' : 'Edit entry'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="button button-danger-ghost" onClick={() => void destroy()}>
            <Icon name="trash" size={16} /> Delete
          </button>
          <span className="spacer" />
          {!running ? (
            <button type="button" className="button button-ghost" onClick={() => void duplicate()}>
              <Icon name="copy" size={16} /> Duplicate
            </button>
          ) : null}
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={update.isPending}>
            Save
          </button>
        </>
      )}
    >
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="field field-full">
          <span>Description</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={3000} />
        </label>
        <div className="field">
          <span>Project</span>
          <button ref={projectButton} type="button" className="select-button" onClick={() => setPicker('project')}>
            {projectId ? <ProjectLabel projectId={projectId} taskId={taskId} /> : <span className="muted">No project</span>}
          </button>
        </div>
        <div className="field">
          <span>Tags</span>
          <button ref={tagButton} type="button" className="select-button" onClick={() => setPicker('tags')}>
            {tags.length ? tags.join(', ') : <span className="muted">No tags</span>}
          </button>
        </div>
        <label className="field checkbox-field">
          <input type="checkbox" checked={billable} onChange={(event) => setBillable(event.target.checked)} />
          <span>Billable{project?.billable ? ' (project default)' : ''}</span>
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} />
        </label>
        <div className="field">
          <label htmlFor={fields.id('start')}>Start</label>
          <input {...fields.field('start')} value={startText} onChange={(event) => setStartText(event.target.value)} onBlur={() => syncDuration(range)} />
          {fields.message('start')}
        </div>
        {!running ? (
          <>
            <div className="field">
              <label htmlFor={fields.id('end')}>End</label>
              <input {...fields.field('end')} value={endText} onChange={(event) => setEndText(event.target.value)} onBlur={() => syncDuration(range)} />
              {fields.message('end')}
            </div>
            <div className="field">
              <label htmlFor={fields.id('duration')}>Duration</label>
              <input {...fields.field('duration')} value={durationText} onChange={(event) => setDurationText(event.target.value)} onBlur={applyDuration} />
              {fields.message('duration')}
            </div>
          </>
        ) : null}
        {range?.stop && localDay(range.stop, settings.timeZone) !== day ? (
          <p className="field-full hint">Ends the next day, {localDay(range.stop, settings.timeZone)}.</p>
        ) : null}
        {!running ? (
          <div className="field field-full">
            <label htmlFor={fields.id('split')}>Split at</label>
            <div className="inline-controls">
              <input {...fields.field('split')} value={splitText} placeholder="e.g. 10:30" onChange={(event) => setSplitText(event.target.value)} />
              <button type="button" className="button button-ghost" onClick={() => void split()}>
                <Icon name="split" size={16} /> Split
              </button>
            </div>
            {fields.message('split')}
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectButton.current}
          projectId={projectId}
          taskId={taskId}
          onChange={(pid, tid) => {
            setProjectId(pid);
            setTaskId(tid);
            const picked = projects.find((p) => p.id === pid);
            if (picked?.billable) setBillable(true);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker anchor={tagButton.current} value={tags} onChange={setTags} onClose={() => setPicker(null)} />
      ) : null}
    </Modal>
  );
}
