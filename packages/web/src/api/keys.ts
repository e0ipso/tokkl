import type { QueryKey } from '@tanstack/react-query';

/** Query keys of the server data. A query whose key starts with one of these refreshes with it. */
export const keys = {
  status: ['status'] as const,
  me: ['me'] as const,
  preferences: ['preferences'] as const,
  workspace: ['workspace'] as const,
  projects: ['projects'] as const,
  clients: ['clients'] as const,
  tags: ['tags'] as const,
  tasks: ['tasks'] as const,
  entries: ['entries'] as const,
  timer: ['timer'] as const,
  report: ['report'] as const,
  trash: ['trash'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminInvites: ['admin', 'invites'] as const,
  adminSettings: ['admin', 'settings'] as const,
};

/**
 * What the server derives from entries: the lists, the reports, the trash, the time tracked on
 * projects and tasks, and the tags an entry saved with new tag names creates. Every change to
 * entries refreshes all of it, whichever way the change arrives.
 */
const entryDerived = [keys.entries, keys.report, keys.trash, keys.projects, keys.tasks, keys.tags] as const;

/**
 * What each kind of write makes stale. A write refreshes every query that shows the data it
 * changed, so the code that writes names the change, not the lists.
 */
export const stale = {
  /** Any entry write from this tab: what entries make, plus the timer state, which carries the running entry. */
  entries: [...entryDerived, keys.timer],
  /**
   * A timer state that moved past the cached one, from the stream, a poll or a timer action: the
   * change started, stopped or discarded entries. The state itself carries the running entry.
   */
  timerChanged: entryDerived,
  /** A client write, which projects and entry rows show. */
  clients: [keys.clients, keys.projects, keys.entries, keys.timer, keys.report],
  /** A project write from the list, which entry rows, tasks and reports show. */
  projects: [keys.projects, keys.tasks, keys.entries, keys.timer, keys.report],
  /** A project deleted with its entries moved to the trash or detached. */
  projectDeleted: [keys.projects, keys.tasks, keys.entries, keys.timer, keys.report, keys.trash],
  /** A project saved from its editor, which can also pick a client. */
  projectSaved: [keys.projects, keys.clients, keys.tasks, keys.entries, keys.timer, keys.report],
  /** A project created from a picker. */
  projectCreated: [keys.projects, keys.clients],
  /** A client created from the project editor. */
  clientCreated: [keys.clients],
  /** A task write. */
  tasks: [keys.tasks, keys.entries, keys.timer, keys.report],
  /** A tag rename or delete, which entry rows show. */
  tags: [keys.tags, keys.entries, keys.timer, keys.report],
  /** A new tag, which no entry uses yet. */
  tagCreated: [keys.tags],
  /** A profile write: day boundaries depend on the timezone and week start. */
  profile: [keys.me, keys.entries, keys.timer, keys.report],
  /** A password or API token change, which replaces the token /me returns. */
  credentials: [keys.me],
  /** A workspace write: rounding and rates change reports and project amounts. */
  workspace: [keys.workspace, keys.report, keys.projects],
  /** An import or restore, which can add entries and every catalog. */
  imported: [keys.entries, keys.timer, keys.projects, keys.clients, keys.tags, keys.tasks, keys.report],
  /** Entries deleted for good from the trash. */
  trash: [keys.trash],
  /** An account changed by an admin, possibly the admin's own. */
  adminUser: [keys.adminUsers, keys.me],
  adminUsers: [keys.adminUsers],
  adminInvites: [keys.adminInvites],
  adminSettings: [keys.adminSettings],
} satisfies Record<string, readonly QueryKey[]>;
