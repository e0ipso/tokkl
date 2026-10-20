import { useMemo, useState } from 'react';
import type { Project, TimeEntry } from '../api/types.ts';

/** What the entry fields edit: the parts of an entry a user picks before or while it runs. */
export interface EntryDraft {
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

export const EMPTY_DRAFT: EntryDraft = { description: '', project_id: null, task_id: null, tags: [], billable: false };

export interface Suggestion extends EntryDraft {
  key: string;
  project_name: string | null;
  project_color: string | null;
}

export const MAX_SUGGESTIONS = 8;

/**
 * Recent entries that match `query` in their description, project or client, newest first. Each
 * description, project and task appears once, and entries with neither a description nor a project
 * are left out.
 */
export function suggestionsFrom(entries: TimeEntry[], query: string): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const q = query.trim().toLowerCase();
  for (const entry of entries) {
    if (!entry.description && !entry.project_id) continue;
    const key = `${entry.description}\u0000${entry.project_id ?? ''}\u0000${entry.task_id ?? ''}`;
    if (seen.has(key)) continue;
    const haystack = `${entry.description} ${entry.project_name ?? ''} ${entry.client_name ?? ''}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    seen.add(key);
    out.push({
      key, description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags,
      billable: entry.billable, project_name: entry.project_name ?? null, project_color: entry.project_color ?? null,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** The draft a picked suggestion fills in: every field, not only the description. */
export function suggestedDraft(suggestion: Suggestion): EntryDraft {
  const { description, project_id, task_id, tags, billable } = suggestion;
  return { description, project_id, task_id, tags, billable };
}

/** The changes picking a project makes. A billable project turns billable on; any other leaves it as it was. */
export function projectChanges(
  draft: EntryDraft, projects: Project[], projectId: number | null, taskId: number | null,
): Pick<EntryDraft, 'project_id' | 'task_id' | 'billable'> {
  const picked = projects.find((p) => p.id === projectId);
  return { project_id: projectId, task_id: taskId, billable: picked?.billable ? true : draft.billable };
}

/**
 * The description suggestions and the billable rule behind the entry fields. Suggestions show only
 * while `showSuggestions` is set; `highlight` is the suggestion the arrow keys moved to, or -1.
 */
export function useEntryFields({ draft, recentEntries, projects }: {
  draft: EntryDraft;
  recentEntries: TimeEntry[];
  projects: Project[];
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const suggestions = useMemo(
    () => (showSuggestions ? suggestionsFrom(recentEntries, draft.description) : []),
    [showSuggestions, recentEntries, draft.description],
  );
  return {
    suggestions,
    setShowSuggestions,
    highlight,
    setHighlight,
    project: projects.find((p) => p.id === draft.project_id),
    projectChanges: (projectId: number | null, taskId: number | null) => projectChanges(draft, projects, projectId, taskId),
  };
}
