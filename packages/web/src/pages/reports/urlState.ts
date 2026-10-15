import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'wouter';
import type { Grouping } from '../../api/types.ts';
import { isDateKey, isPreset, presetRange, type DateRange, type Preset } from './range.ts';

export const TABS = ['summary', 'detailed', 'weekly'] as const;
export type Tab = (typeof TABS)[number];

export const GROUPINGS: readonly Grouping[] = ['projects', 'clients', 'tags', 'time_entries', 'tasks'];
export type SubGrouping = Grouping | 'none';

export type BillableFilter = 'all' | 'billable' | 'nonbillable';
export type SortKey = 'date' | 'duration' | 'description';
export type SortDir = 'asc' | 'desc';
export type WeeklyRows = 'projects' | 'clients';

/** An id filter: numbers are ids, null means "without". An empty list means no filter. */
export type IdFilter = ReadonlyArray<number | null>;

export interface ReportState {
  /** Set when the range follows a preset, so a bookmark of "this week" stays relative. */
  readonly preset: Preset | null;
  readonly range: DateRange;
  readonly tab: Tab;
  readonly grouping: Grouping;
  readonly subGrouping: SubGrouping;
  readonly projects: IdFilter;
  readonly clients: IdFilter;
  readonly tags: IdFilter;
  /** When set, the matching filter means "is not" instead of "is". */
  readonly projectsNot: boolean;
  readonly clientsNot: boolean;
  readonly tagsNot: boolean;
  readonly billable: BillableFilter;
  readonly description: string;
  readonly sort: SortKey;
  readonly dir: SortDir;
  readonly page: number;
  readonly weeklyRows: WeeklyRows;
}

export type ReportPatch = Partial<Omit<ReportState, 'range' | 'preset'>> & {
  readonly range?: DateRange;
  readonly preset?: Preset | null;
};

const DEFAULT_PRESET: Preset = 'this_week';

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A leading "not." in an id list marks the filter as negated, e.g. "not.none.4", or just "not.". */
function isNegated(value: string | null): boolean {
  return value?.startsWith('not.') ?? false;
}

/** Ids are dot-separated ("none.4.9") because URLSearchParams would percent-encode commas. */
function parseIds(raw: string | null): IdFilter {
  const value = isNegated(raw) ? raw!.slice(4) : raw;
  if (!value) return [];
  const ids: Array<number | null> = [];
  for (const part of value.split(/[.,]/)) {
    if (part === 'none') ids.push(null);
    else if (/^\d+$/.test(part)) ids.push(Number(part));
  }
  return ids;
}

function formatIds(ids: IdFilter, negated: boolean): string {
  return `${negated ? 'not.' : ''}${ids.map((id) => (id === null ? 'none' : String(id))).join('.')}`;
}

export function parseState(params: URLSearchParams, todayKey: string, beginningOfWeek: number, firstDay?: string | null): ReportState {
  const from = params.get('from');
  const to = params.get('to');
  const rangeParam = params.get('range');
  let preset: Preset | null = null;
  let range: DateRange;
  if (isDateKey(from) && isDateKey(to) && from <= to) {
    range = { from, to };
  } else {
    preset = isPreset(rangeParam) ? rangeParam : DEFAULT_PRESET;
    range = presetRange(preset, todayKey, beginningOfWeek, firstDay);
  }
  const grouping = oneOf(params.get('group'), GROUPINGS, 'projects');
  const sub = oneOf<SubGrouping>(params.get('sub'), [...GROUPINGS, 'none'], 'time_entries');
  const page = Number(params.get('page'));
  return {
    preset,
    range,
    tab: oneOf(params.get('tab'), TABS, 'summary'),
    grouping,
    subGrouping: sub === grouping ? 'none' : sub,
    projects: parseIds(params.get('projects')),
    clients: parseIds(params.get('clients')),
    tags: parseIds(params.get('tags')),
    projectsNot: isNegated(params.get('projects')),
    clientsNot: isNegated(params.get('clients')),
    tagsNot: isNegated(params.get('tags')),
    billable: oneOf(params.get('billable'), ['all', 'billable', 'nonbillable'] as const, 'all'),
    description: params.get('q') ?? '',
    sort: oneOf(params.get('sort'), ['date', 'duration', 'description'] as const, 'date'),
    dir: oneOf(params.get('dir'), ['asc', 'desc'] as const, 'desc'),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    weeklyRows: oneOf(params.get('rows'), ['projects', 'clients'] as const, 'projects'),
  };
}

/** Writes only the values that differ from the defaults, so URLs stay short. */
export function serializeState(state: ReportState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.preset) {
    if (state.preset !== DEFAULT_PRESET) params.set('range', state.preset);
  } else {
    params.set('from', state.range.from);
    params.set('to', state.range.to);
  }
  if (state.tab !== 'summary') params.set('tab', state.tab);
  if (state.grouping !== 'projects') params.set('group', state.grouping);
  if (state.subGrouping !== 'time_entries') params.set('sub', state.subGrouping);
  // "not." with no ids keeps an "Is not" chosen before any option; it filters nothing yet.
  if (state.projects.length || state.projectsNot) params.set('projects', formatIds(state.projects, state.projectsNot));
  if (state.clients.length || state.clientsNot) params.set('clients', formatIds(state.clients, state.clientsNot));
  if (state.tags.length || state.tagsNot) params.set('tags', formatIds(state.tags, state.tagsNot));
  if (state.billable !== 'all') params.set('billable', state.billable);
  if (state.description) params.set('q', state.description);
  if (state.sort !== 'date') params.set('sort', state.sort);
  if (state.dir !== 'desc') params.set('dir', state.dir);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.weeklyRows !== 'projects') params.set('rows', state.weeklyRows);
  return params;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Keys whose change makes the current page of the detailed table meaningless. */
const RESETS_PAGE: ReadonlyArray<keyof ReportPatch> = [
  'range', 'preset', 'projects', 'clients', 'tags', 'projectsNot', 'clientsNot', 'tagsNot', 'billable', 'description', 'sort', 'dir',
];

/**
 * Report state lives in the query string, so every report is a bookmarkable URL. Updates replace
 * the history entry instead of pushing, which keeps the back button from replaying each click.
 */
export function useReportState(todayKey: string, beginningOfWeek: number, firstDay?: string | null): [ReportState, (patch: ReportPatch) => void] {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const state = useMemo(
    () => parseState(new URLSearchParams(key), todayKey, beginningOfWeek, firstDay),
    [key, todayKey, beginningOfWeek, firstDay],
  );
  const update = useCallback((patch: ReportPatch) => {
    const current = parseState(new URLSearchParams(window.location.search), todayKey, beginningOfWeek, firstDay);
    const next: Mutable<ReportState> = { ...current, ...patch };
    if (patch.range && patch.preset === undefined) next.preset = null;
    if (patch.page === undefined && RESETS_PAGE.some((name) => name in patch)) next.page = 1;
    if (next.subGrouping === next.grouping) next.subGrouping = 'none';
    setParams(serializeState(next), { replace: true });
  }, [setParams, todayKey, beginningOfWeek, firstDay]);
  return [state, update];
}
