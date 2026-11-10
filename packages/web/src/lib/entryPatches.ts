import type { Favorite, PatchOperation } from '@tokkl/types';

export const entryPatch = {
  description: (description: string): PatchOperation[] => [{ op: 'replace', path: '/description', value: description }],
  billable: (billable: boolean): PatchOperation[] => [{ op: 'replace', path: '/billable', value: billable }],
  /** A project change carries its task, so a task never stays on another project. */
  project: (projectId: number | null, taskId: number | null): PatchOperation[] => [
    { op: 'replace', path: '/project_id', value: projectId },
    { op: 'replace', path: '/task_id', value: taskId },
  ],
  tags: (tags: string[]): PatchOperation[] => [{ op: 'replace', path: '/tags', value: tags }],
  /** Keeps the ones each entry has. */
  addTags: (tags: string[]): PatchOperation[] => [{ op: 'add', path: '/tags', value: tags }],
};

/** Each with its number key. */
export const MAX_FAVORITES = 9;

/** Null when every number key is taken. */
export function withFavorite(favorites: readonly Favorite[], favorite: Favorite): Favorite[] | null {
  return favorites.length >= MAX_FAVORITES ? null : [...favorites, favorite];
}
