import { useRef, useState } from 'react';
import type { PatchOperation } from '../api/types.ts';
import { entryPatch } from '../lib/entryPatches.ts';
import { Icon } from './Icon.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { useBulkEdit, useDeleteEntries } from './useEntryListActions.ts';
import { t } from '../i18n/messages.ts';

/** Actions on the selected entries. Every action ends the selection once the server answers. */
export function BulkBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const bulkEdit = useBulkEdit();
  const deleteEntries = useDeleteEntries();

  const patch = (operations: PatchOperation[], success: string) => bulkEdit(ids, operations, { success, onDone });

  const deleteAll = async () => {
    await deleteEntries(ids);
    onDone();
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label={t('entries.bulkLabel')}>
      <strong>{t('entries.bulkSelected', { count: ids.length })}</strong>
      <button ref={projectRef} type="button" className="button button-ghost" onClick={() => setPicker('project')}>
        <Icon name="folder" size={16} /> {t('entries.project')}
      </button>
      <button ref={tagRef} type="button" className="button button-ghost" onClick={() => setPicker('tags')}>
        <Icon name="tag" size={16} /> {t('entries.bulkAddTags')}
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch(entryPatch.billable(true), t('entries.bulkMarkedBillable'))}
      >
        {t('entries.billable')}
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch(entryPatch.billable(false), t('entries.bulkMarkedNonBillable'))}
      >
        {t('entries.bulkNonBillable')}
      </button>
      <button type="button" className="button button-danger-ghost" onClick={() => void deleteAll()}>
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
