import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { keys, useTags, useWid } from '../api/hooks.ts';
import type { Tag } from '../api/types.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { includesText, useAction, wsPath } from './manage/queries.ts';
import { focusPastRow } from './manage/rowFocus.ts';
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
    <tr data-id={tag.id}>
      <td>
        {draft === null ? (
          <button type="button" className="manage-name-button" title="Rename" onClick={() => setDraft(tag.name)}>
            <span className="tag-chip">{tag.name}</span>
          </button>
        ) : (
          <input
            className="inline-input"
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
        <button type="button" className="icon-button" aria-label={`Delete ${tag.name}`} title="Delete" data-row-action="delete" onClick={onDelete}>
          <Icon name="trash" size={16} />
        </button>
      </td>
    </tr>
  );
}

export function TagsPage() {
  const wid = useWid();
  const fields = useFieldErrors<'name'>();
  const { data: tags, isLoading, error, refetch } = useTags();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

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
    onSuccess: (_result, tag) => {
      // The dialog had focus and would give it back to the row's Delete button, which goes away.
      focusPastRow(tbody.current, tag.id, 'delete', heading.current);
      setDeleting(null);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!fields.validate([['name', !trimmed && 'Enter a tag name']])) return;
    create.mutate(trimmed);
  };

  const visible = (tags ?? []).filter((tag) => includesText(tag.name, search));

  return (
    <div className="page manage-page manage-narrow">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>Tags</h1>
      </header>

      <div className="toolbar">
        <form className="field" onSubmit={submit}>
          <div className="inline-controls">
            <input {...fields.field('name')} value={newName} placeholder="New tag" aria-label="New tag name" maxLength={255} onChange={(event) => setNewName(event.target.value)} />
            <button type="submit" className="button button-primary" disabled={create.isPending}>
              <Icon name="plus" size={16} /> Add tag
            </button>
          </div>
          {fields.message('name')}
        </form>
        <span className="spacer" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search tags" />
      </div>

      {error ? <LoadError message={`Could not load tags: ${error.message}`} onRetry={() => void refetch()} /> : null}
      {isLoading ? <Loading label="Loading tags…" /> : null}
      {tags && visible.length === 0 ? (
        tags.length === 0 ? (
          <EmptyState icon={<Icon name="tag" size={32} />} title="No tags yet">
            Tags label entries across projects, like "meeting" or "review". Add one above.
          </EmptyState>
        ) : (
          <EmptyState icon={<Icon name="search" size={32} />} title="No tags match your search">
            Check the spelling, or clear the search.
          </EmptyState>
        )
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
            <tbody ref={tbody}>
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
