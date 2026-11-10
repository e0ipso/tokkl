import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClients } from '../../api/clients.ts';
import { useProjects } from '../../api/projects.ts';
import { useTags } from '../../api/tags.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Popover } from '../../components/Overlay.tsx';
import { ProjectDot } from '../../components/ProjectLabel.tsx';
import { SearchBox, Segmented } from '../manage/ui.tsx';
import { BILLABLE_FILTERS, isOneOf, type IdFilter, type ReportPatch, type ReportState } from './urlState.ts';
import { t } from '../../i18n/messages.ts';

interface Option {
  readonly id: number | null;
  readonly label: string;
  readonly color?: string | null;
  readonly hint?: string | null;
}

function MultiSelect({
  label,
  noun,
  options,
  value,
  onChange,
  negated,
  onNegatedChange,
  showDots = false,
}: {
  label: string;
  /** Inside a sentence, as in "Find project…". */
  noun: string;
  options: readonly Option[];
  value: IdFilter;
  onChange: (next: IdFilter) => void;
  negated: boolean;
  onNegatedChange: (next: boolean) => void;
  showDots?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const selected = new Set(value);
  const visible = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (id: number | null) => {
    onChange(selected.has(id) ? value.filter(v => v !== id) : [...value, id]);
  };
  const picked =
    value.length === 0
      ? null
      : value.length === 1
        ? (options.find(o => o.id === value[0])?.label ?? t('reports.filterOneSelected'))
        : t('reports.filterSelected', { count: value.length });
  const summary = picked && negated ? t('reports.filterNot', { picked }) : picked;
  const modes = [
    { value: 'is', label: t('reports.filterIs') },
    { value: 'not', label: t('reports.filterIsNot') },
  ] as const;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`filter-chip${value.length ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span>{label}</span>
        {summary ? <span className="filter-chip-value">{summary}</span> : null}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <Popover
          anchor={button}
          label={t('reports.filterPopover', { label })}
          onClose={() => {
            setOpen(false);
            setQuery('');
          }}
          width={280}
        >
          <input
            className="picker-search"
            autoFocus
            placeholder={t('reports.filterFind', { noun })}
            aria-label={t('reports.filterFindLabel', { noun })}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <Segmented
            className="filter-mode"
            label={t('reports.filterMode', { label })}
            options={modes}
            value={negated ? 'not' : 'is'}
            onChange={mode => onNegatedChange(mode === 'not')}
          />
          <div className="picker-list">
            {visible.map(option => (
              <label key={option.id ?? 'none'} className="picker-item picker-check">
                <input type="checkbox" checked={selected.has(option.id)} onChange={() => toggle(option.id)} />
                {showDots ? <ProjectDot color={option.color} /> : null}
                <span className={option.id === null ? 'muted' : undefined}>{option.label}</span>
                {option.hint ? <span className="muted filter-option-hint">{option.hint}</span> : null}
              </label>
            ))}
            {visible.length === 0 ? (
              <EmptyState compact title={t('reports.nothingMatches')}>
                {query.trim() ? t('reports.shorterSearch') : null}
              </EmptyState>
            ) : null}
          </div>
          {value.length ? (
            <div className="filter-popover-footer">
              <button type="button" className="link-button" onClick={() => onChange([])}>
                {t('reports.clear')}
              </button>
            </div>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

/** Writes to the URL 300 ms after the last keystroke. */
function DescriptionSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [text, setText] = useState(value);
  const latest = useRef(value);
  useEffect(() => {
    if (value !== latest.current) {
      latest.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === latest.current) return;
    const id = setTimeout(() => {
      latest.current = text;
      onChange(text);
    }, 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return (
    <SearchBox
      value={text}
      onChange={setText}
      placeholder={t('reports.description')}
      label={t('reports.filterByDescription')}
    />
  );
}

export function Filters({ state, update }: { state: ReportState; update: (patch: ReportPatch) => void }) {
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: tags = [] } = useTags();

  const projectOptions = useMemo<Option[]>(
    () => [
      { id: null, label: t('reports.withoutProject') },
      ...[...projects]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map(p => ({ id: p.id, label: p.name, color: p.color, hint: p.client_name })),
    ],
    [projects],
  );
  const clientOptions = useMemo<Option[]>(
    () => [
      { id: null, label: t('reports.withoutClient') },
      ...[...clients].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, label: c.name })),
    ],
    [clients],
  );
  const tagOptions = useMemo<Option[]>(
    () => [
      { id: null, label: t('reports.withoutTags') },
      ...[...tags].sort((a, b) => a.name.localeCompare(b.name)).map(t => ({ id: t.id, label: t.name })),
    ],
    [tags],
  );

  const onDescription = useCallback((description: string) => update({ description }), [update]);
  const active =
    state.projects.length + state.clients.length + state.tags.length > 0 ||
    state.billable !== 'all' ||
    state.description !== '';

  return (
    <div className="report-filters" role="group" aria-label={t('reports.filters')}>
      <MultiSelect
        label={t('reports.filterProject')}
        noun={t('reports.filterProjectNoun')}
        options={projectOptions}
        value={state.projects}
        onChange={projects => update({ projects })}
        negated={state.projectsNot}
        onNegatedChange={projectsNot => update({ projectsNot })}
        showDots
      />
      <MultiSelect
        label={t('reports.filterClient')}
        noun={t('reports.filterClientNoun')}
        options={clientOptions}
        value={state.clients}
        onChange={clients => update({ clients })}
        negated={state.clientsNot}
        onNegatedChange={clientsNot => update({ clientsNot })}
      />
      <MultiSelect
        label={t('reports.filterTag')}
        noun={t('reports.filterTagNoun')}
        options={tagOptions}
        value={state.tags}
        onChange={tags => update({ tags })}
        negated={state.tagsNot}
        onNegatedChange={tagsNot => update({ tagsNot })}
      />
      <select
        className={`filter-select${state.billable !== 'all' ? ' active' : ''}`}
        aria-label={t('reports.billable')}
        value={state.billable}
        onChange={event => {
          const value = event.target.value;
          if (isOneOf(value, BILLABLE_FILTERS)) update({ billable: value });
        }}
      >
        <option value="all">{t('reports.billableAll')}</option>
        <option value="billable">{t('reports.billableOnly')}</option>
        <option value="nonbillable">{t('reports.nonBillableOnly')}</option>
      </select>
      <DescriptionSearch value={state.description} onChange={onDescription} />
      {active ? (
        <button
          type="button"
          className="link-button"
          onClick={() =>
            update({
              projects: [],
              clients: [],
              tags: [],
              projectsNot: false,
              clientsNot: false,
              tagsNot: false,
              billable: 'all',
              description: '',
            })
          }
        >
          {t('reports.clearFilters')}
        </button>
      ) : null}
    </div>
  );
}
