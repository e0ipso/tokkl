import { useState, type RefObject } from 'react';
import { useCreateTag, useTags } from '../api/tags.ts';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { useToast } from './Toast.tsx';
import { useExclusive } from './useExclusive.ts';
import { t } from '../i18n/messages.ts';

/** Unknown names can be created. Works with tag names, like the Toggl API. */
export function TagPicker({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  value: string[];
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();
  const toast = useToast();
  // Enter and a click on Create can arrive before the first create shows up; the tag is made once.
  const creating = useExclusive();
  const selected = new Set(value.map(name => name.toLowerCase()));
  const visible = tags.filter(tag => tag.name.toLowerCase().includes(query.toLowerCase()));
  const exact = tags.some(tag => tag.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (name: string) => {
    onChange(
      selected.has(name.toLowerCase()) ? value.filter(v => v.toLowerCase() !== name.toLowerCase()) : [...value, name],
    );
  };
  const create = () =>
    creating.run(async () => {
      const name = query.trim();
      if (!name || exact) return;
      try {
        const tag = await createTag.mutateAsync(name);
        onChange([...value, tag.name]);
        setQuery('');
      } catch (error) {
        toast.error(error);
      }
    });

  return (
    <Popover anchor={anchor} label={t('entries.tags')} onClose={onClose} width={260}>
      <input
        className="picker-search"
        autoFocus
        placeholder={t('entries.pickerTagSearch')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (event.ctrlKey || event.metaKey || visible.length === 0) void create();
          else if (visible[0]) toggle(visible[0].name);
        }}
      />
      <div className="picker-list">
        {visible.map(tag => (
          <label key={tag.id} className="picker-item picker-check">
            <input type="checkbox" checked={selected.has(tag.name.toLowerCase())} onChange={() => toggle(tag.name)} />
            {tag.name}
          </label>
        ))}
        {query.trim() && !exact ? (
          <button type="button" className="picker-item picker-create" onClick={() => void create()}>
            <Icon name="plus" size={14} /> {t('entries.createTag', { name: query.trim() })}
          </button>
        ) : null}
        {tags.length === 0 && !query ? <div className="picker-empty">{t('entries.noTagsYet')}</div> : null}
      </div>
    </Popover>
  );
}
