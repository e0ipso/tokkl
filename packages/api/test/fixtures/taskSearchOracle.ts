import type { TaskSearch } from '../../src/domain/queries.ts';
import type { TaskSummary } from '../../src/domain/model.ts';
import { slicePage, type PageWindow } from '../../src/lib/pagination.ts';

/**
 * The workspace task search as it was when it read every task's sort key and filtered, sorted and
 * paged them in memory. The SQL search must answer exactly this.
 */
export function oracle(all: TaskSummary[], search: TaskSearch, window: PageWindow) {
  const direction = search.sortOrder === 'ASC' ? 1 : -1;
  const needle = search.search?.toLowerCase();
  const kept = all
    .filter(task => search.projectId === undefined || task.projectId === search.projectId)
    .filter(task => search.active === undefined || task.active === search.active)
    .filter(task => search.changedSince === undefined || task.updatedAt >= search.changedSince)
    .filter(task => !needle || task.name.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        direction *
        ((search.sortField === 'name'
          ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : a.createdAt.localeCompare(b.createdAt)) || a.id - b.id),
    );
  return { tasks: slicePage(kept, window), totalCount: kept.length };
}

// Case folding beyond ASCII (Kelvin sign, dotted I, sharp s, final sigma), accents, ties after
// folding, punctuation, digits, LIKE wildcards and characters outside the BMP.
export const NAMES = [
  'alpha',
  'Alpha',
  'ALPHA',
  'Ébène',
  'ebene',
  'Kelvin K',
  'XK',
  'kelvin k',
  'İstanbul',
  'istanbul',
  'Straße',
  'STRASSE',
  'ΟΔΟΣ',
  'a_b',
  'a-b',
  'a b',
  'a%b',
  '10',
  '9',
  'ñandú',
  '😀 smile',
  'Zeta',
  'zeta ',
];
export const SEARCHES = [
  undefined,
  '',
  'a',
  'A',
  'k',
  'xk',
  'XK',
  'K',
  'i̇',
  'İ',
  'é',
  'ß',
  'ς',
  '%',
  '_',
  '😀',
  ' ',
  'zz',
];
