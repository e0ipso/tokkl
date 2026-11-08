import { useRef, useState } from 'react';
import type { PatchOperation } from '../api/types.ts';
import { entryPatch } from '../lib/entryPatches.ts';
import { Icon } from './Icon.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { useExclusive } from './useExclusive.ts';
import { useBulkEdit, useDeleteEntries } from './useEntryListActions.ts';
import { t } from '../i18n/messages.ts';

/**
 * Actions on the selected entries. Every action ends the selection once the server answers. One
 * runs at a time: the action buttons are disabled until the server answers, so a double click
 * never deletes or edits the selection twice.
 */
export function BulkBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const bulkEdit = useBulkEdit();
  const deleteEntries = useDeleteEntries();
  const actions = useExclusive();

  const patch = (operations: PatchOperation[], success: string) =>
    void actions.run(() => bulkEdit(ids, operations, { success, onDone }));

  const deleteAll = () =>
    actions.run(async () => {
      await deleteEntries(ids);
      onDone();
    });

  return (
    <div className="bulk-bar" role="toolbar" aria-label={t('entries.bulkLabel')}>
      <strong>{t('entries.bulkSelected', { count: ids.length })}</strong>
      <button
        ref={projectRef}
        type="button"
        className="button button-ghost"
        onClick={() => setPicker('project')}
        disabled={actions.busy}
      >
        <Icon name="folder" size={16} /> {t('entries.project')}
      </button>
      <button
        ref={tagRef}
        type="button"
        className="button button-ghost"
        onClick={() => setPicker('tags')}
        disabled={actions.busy}
      >
        <Icon name="tag" size={16} /> {t('entries.bulkAddTags')}
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch(entryPatch.billable(true), t('entries.bulkMarkedBillable'))}
        disabled={actions.busy}
      >
        {t('entries.billable')}
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch(entryPatch.billable(false), t('entries.bulkMarkedNonBillable'))}
        disabled={actions.busy}
      >
        {t('entries.bulkNonBillable')}
      </button>
      <button
        type="button"
        className="button button-danger-ghost"
        onClick={() => void deleteAll()}
        disabled={actions.busy}
      >
        <Icon name="trash" size={16} /> {t('common.delete')}
      </button>
      <span className="spacer" />
      <button type="button" className="button button-ghost" onClick={onDone}>
        {t('entries.bulkClear')}
      </button>
      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef}
          projectId={null}
          taskId={null}
          onChange={(pid, tid) => patch(entryPatch.project(pid, tid), t('entries.bulkProjectUpdated'))}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef}
          value={[]}
          onChange={tags => {
            setPicker(null);
            patch(entryPatch.addTags(tags), t('entries.bulkTagsAdded'));
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
