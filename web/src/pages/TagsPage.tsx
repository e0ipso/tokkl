import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { keys, useTags, useWid } from '../api/hooks.ts';
import type { Tag } from '../api/types.ts';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { includesText, useAction, wsPath } from './manage/queries.ts';
import { ConfirmModal, SearchBox } from './manage/ui.tsx';
import './manage/manage.css';

const TAG_KEYS = [keys.tags, keys.entries, keys.current, keys.report] as const;

function TagRow({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const wid = useWid();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const rename = useAction<string, Tag>({
    mutationFn: (name) => api.put<Tag>(wsPath(wid, 'tags', tag.id), { name }),
    invalidate: TAG_KEYS,
    success: (saved) => `Renamed to ${saved.name}`,
    onSuccess: () => setDraft(null),
  });

  // Blur is the only place that saves, so Enter and clicking away can't both send a request.
  const commit = () => {
    const trimmed = draft?.trim() ?? '';
    if (cancelled.current || !trimmed || trimmed === tag.name) {
      cancelled.current = false;
      return setDraft(null);
    }
    rename.mutate(trimmed);
  };

  return (
    <tr>
      <td>
        {draft === null ? (
          <button type="button" className="manage-name-button" title="Rename" onClick={() => setDraft(tag.name)}>
            <span className="tag-chip">{tag.name}</span>
          </button>
        ) : (
          <input
            className="manage-inline-input"
            value={draft}
            aria-label={`New name for ${tag.name}`}
            maxLength={255}
            autoFocus
            disabled={rename.isPending}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                cancelled.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        )}
      </td>
      <td className="manage-actions">
        <button type="button" className="icon-button" aria-label={`Rename ${tag.name}`} title="Rename" onClick={() => setDraft(tag.name)}>
          <Icon name="edit" size={16} />
        </button>
        <button type="button" className="icon-button" aria-label={`Delete ${tag.name}`} title="Delete" onClick={onDelete}>
          <Icon name="trash" size={16} />
        </button>
      </td>
    </tr>
  );
}

export function TagsPage() {
  const wid = useWid();
  const toast = useToast();
  const { data: tags, isLoading, error } = useTags();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Tag | null>(null);

  const create = useAction<string, Tag>({
    mutationFn: (name) => api.post<Tag>(wsPath(wid, 'tags'), { name }),
    invalidate: [keys.tags],
    success: (tag) => `Created ${tag.name}`,
    onSuccess: () => setNewName(''),
  });
  const remove = useAction<Tag>({
    mutationFn: (tag) => api.delete(wsPath(wid, 'tags', tag.id)),
    invalidate: TAG_KEYS,
    success: (_result, tag) => `Deleted ${tag.name}`,
    onSuccess: () => setDeleting(null),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return toast.show('Enter a tag name', { kind: 'error' });
    create.mutate(trimmed);
  };

  const visible = (tags ?? []).filter((tag) => includesText(tag.name, search));

  return (
    <div className="page manage-page manage-narrow">
      <header className="page-header">
        <h1>Tags</h1>
      </header>

      <div className="toolbar">
        <form className="inline-controls" onSubmit={submit}>
          <input value={newName} placeholder="New tag" aria-label="New tag name" maxLength={255} onChange={(event) => setNewName(event.target.value)} />
          <button type="submit" className="button button-primary" disabled={create.isPending}>
            <Icon name="plus" size={16} /> Add tag
          </button>
        </form>
        <span className="spacer" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search tags" />
      </div>

      {error ? <p className="form-error">Could not load tags: {error.message}</p> : null}
      {isLoading ? <p className="empty-state">Loading tags…</p> : null}
      {tags && visible.length === 0 ? (
        <p className="empty-state">{tags.length === 0 ? 'No tags yet. Tags label entries across projects, like "meeting" or "review".' : 'No tags match your search.'}</p>
      ) : null}

      {visible.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tag) => <TagRow key={tag.id} tag={tag} onDelete={() => setDeleting(tag)} />)}
            </tbody>
          </table>
        </div>
      ) : null}
      {tags && tags.length > 0 ? <p className="hint manage-footnote">Click a tag to rename it. Renaming updates every entry that uses it.</p> : null}

      {deleting ? (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete tag"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        >
          <p>The tag comes off every time entry that has it. The entries stay. You can't undo this.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
