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
  current: ['current'] as const,
  timer: ['timer'] as const,
  report: ['report'] as const,
  trash: ['trash'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminInvites: ['admin', 'invites'] as const,
  adminSettings: ['admin', 'settings'] as const,
};

/**
 * What each kind of write makes stale. A write refreshes every query that shows the data it
 * changed, so the code that writes names the change, not the lists.
 */
export const stale = {
  /** Any entry write: the lists, the running entry, totals, and the time shown on projects and tags. */
  entries: [keys.entries, keys.current, keys.timer, keys.report, keys.projects, keys.tags, keys.trash],
  /** A client write, which projects and entry rows show. */
  clients: [keys.clients, keys.projects, keys.entries, keys.current, keys.report],
  /** A project write from the list, which entry rows, tasks and reports show. */
  projects: [keys.projects, keys.tasks, keys.entries, keys.current, keys.report],
  /** A project deleted with its entries moved to the trash or detached. */
  projectDeleted: [keys.projects, keys.tasks, keys.entries, keys.current, keys.report, keys.trash],
  /** A project saved from its editor, which can also pick a client. */
  projectSaved: [keys.projects, keys.clients, keys.tasks, keys.entries, keys.current, keys.report],
  /** A project created from a picker. */
  projectCreated: [keys.projects, keys.clients],
  /** A client created from the project editor. */
  clientCreated: [keys.clients],
  /** A task write. */
  tasks: [keys.tasks, keys.entries, keys.current, keys.report],
  /** A tag rename or delete, which entry rows show. */
  tags: [keys.tags, keys.entries, keys.current, keys.report],
  /** A new tag, which no entry uses yet. */
  tagCreated: [keys.tags],
  /** A profile write: day boundaries depend on the timezone and week start. */
  profile: [keys.me, keys.entries, keys.current, keys.report],
  /** A password or API token change, which replaces the token /me returns. */
  credentials: [keys.me],
  /** A workspace write: rounding and rates change reports and project amounts. */
  workspace: [keys.workspace, keys.report, keys.projects],
  /** An import or restore, which can add entries and every catalog. */
  imported: [keys.entries, keys.current, keys.projects, keys.clients, keys.tags, keys.tasks, keys.report],
  /** Entries deleted for good from the trash. */
  trash: [keys.trash],
  /** An account changed by an admin, possibly the admin's own. */
  adminUser: [keys.adminUsers, keys.me],
  adminUsers: [keys.adminUsers],
  adminInvites: [keys.adminInvites],
  adminSettings: [keys.adminSettings],
} satisfies Record<string, readonly QueryKey[]>;
