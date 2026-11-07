import { useRef, useState } from 'react';
import type { PatchOperation } from '../api/types.ts';
import { Icon } from './Icon.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { useBulkEdit, useDeleteEntries } from './useEntryListActions.ts';

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
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <button ref={projectRef} type="button" className="button button-ghost" onClick={() => setPicker('project')}>
        <Icon name="folder" size={16} /> Project
      </button>
      <button ref={tagRef} type="button" className="button button-ghost" onClick={() => setPicker('tags')}>
        <Icon name="tag" size={16} /> Add tags
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch([{ op: 'replace', path: '/billable', value: true }], 'Marked billable')}
      >
        Billable
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={() => patch([{ op: 'replace', path: '/billable', value: false }], 'Marked non-billable')}
      >
        Non-billable
      </button>
      <button type="button" className="button button-danger-ghost" onClick={() => void deleteAll()}>
        <Icon name="trash" size={16} /> Delete
      </button>
      <span className="spacer" />
      <button type="button" className="button button-ghost" onClick={onDone}>
        Clear
      </button>
      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef}
          projectId={null}
          taskId={null}
          onChange={(pid, tid) =>
            patch(
              [
                { op: 'replace', path: '/project_id', value: pid },
                { op: 'replace', path: '/task_id', value: tid },
              ],
              'Project updated',
            )
          }
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef}
          value={[]}
          onChange={tags => {
            setPicker(null);
            patch([{ op: 'add', path: '/tags', value: tags }], 'Tags added');
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
