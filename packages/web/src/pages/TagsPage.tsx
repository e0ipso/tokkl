import { useRef, useState, type FormEvent } from 'react';
import { useWid } from '../api/account.ts';
import { stale } from '../api/keys.ts';
import { tagRequests, useTags } from '../api/tags.ts';
import type { Tag } from '../api/types.ts';
import { useFieldErrors } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { closeModalThen } from '../components/Overlay.tsx';
import { useAction } from '../components/useAction.ts';
import { includesText } from './manage/values.ts';
import { focusPastRow } from './manage/rowFocus.ts';
import { ConfirmModal, SearchBox } from './manage/ui.tsx';
import { ManageList } from './manage/ManageList.tsx';
import './manage/manage.css';
import { t } from '../i18n/messages.ts';

function TagRow({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const wid = useWid();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const rename = useAction<string, Tag>({
    mutationFn: name => tagRequests.rename(wid, tag.id, name),
    invalidate: stale.tags,
    success: saved => t('manage.renamedTo', { name: saved.name }),
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
          <button
            type="button"
            className="manage-name-button"
            title={t('manage.rename')}
            onClick={() => setDraft(tag.name)}
          >
            <span className="tag-chip">{tag.name}</span>
          </button>
        ) : (
          <input
            className="inline-input"
            value={draft}
            aria-label={t('manage.newNameFor', { name: tag.name })}
            maxLength={255}
            autoFocus
            disabled={rename.isPending}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
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
        <button
          type="button"
          className="icon-button"
          aria-label={t('manage.renameNamed', { name: tag.name })}
          title={t('manage.rename')}
          onClick={() => setDraft(tag.name)}
        >
          <Icon name="edit" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('manage.deleteAria', { name: tag.name })}
          title={t('common.delete')}
          data-row-action="delete"
          onClick={onDelete}
        >
          <Icon name="trash" size={16} />
        </button>
      </td>
    </tr>
  );
}

export function TagsPage() {
  const wid = useWid();
  const fields = useFieldErrors<'name'>();
  const tagsQuery = useTags();
  const { data: tags } = tagsQuery;
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const create = useAction<string, Tag>({
    mutationFn: name => tagRequests.create(wid, name),
    invalidate: stale.tagCreated,
    success: tag => t('manage.created', { name: tag.name }),
    onSuccess: () => setNewName(''),
  });
  const remove = useAction<Tag>({
    mutationFn: tag => tagRequests.remove(wid, tag.id),
    invalidate: stale.tags,
    success: (_result, tag) => t('manage.deletedNamed', { name: tag.name }),
    onSuccess: (_result, tag) => {
      // The dialog had focus and would give it back to the row's Delete button, which goes away.
      closeModalThen(
        () => setDeleting(null),
        () => focusPastRow(tbody.current, tag.id, 'delete', heading.current),
      );
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!fields.validate([['name', !trimmed && t('manage.enterTagName')]])) return;
    create.mutate(trimmed);
  };

  const visible = (tags ?? []).filter(tag => includesText(tag.name, search));

  return (
    <div className="page manage-page manage-narrow">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          {t('manage.tagsTitle')}
        </h1>
      </header>

      <div className="toolbar">
        <form className="field" onSubmit={submit}>
          <div className="inline-controls">
            <input
              {...fields.field('name')}
              value={newName}
              placeholder={t('manage.newTagPlaceholder')}
              aria-label={t('manage.newTagName')}
              maxLength={255}
              onChange={event => setNewName(event.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={create.isPending}>
              <Icon name="plus" size={16} /> {t('manage.addTag')}
            </button>
          </div>
          {fields.message('name')}
        </form>
        <span className="spacer" />
        <SearchBox value={search} onChange={setSearch} placeholder={t('manage.searchTags')} />
      </div>

      <ManageList
        query={tagsQuery}
        visible={visible}
        noun={t('manage.tagsNoun')}
        empty={{
          icon: 'tag',
          title: t('manage.noTagsYet'),
          body: t('manage.noTagsBody'),
        }}
        noMatch={{ title: t('manage.noTagsMatch'), body: t('manage.noTagsMatchBody') }}
        headers={
          <>
            <th>{t('manage.tag')}</th>
          </>
        }
        tbodyRef={tbody}
      >
        {visible.map(tag => (
          <TagRow key={tag.id} tag={tag} onDelete={() => setDeleting(tag)} />
        ))}
      </ManageList>
      {tags && tags.length > 0 ? <p className="hint manage-footnote">{t('manage.renameHint')}</p> : null}

      {deleting ? (
        <ConfirmModal
          title={t('manage.deleteNamed', { name: deleting.name })}
          confirmLabel={t('manage.deleteTagButton')}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        >
          <p>{t('manage.deleteTagBody')}</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
