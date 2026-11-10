import type { QueryKey } from '@tanstack/react-query';

/** A query whose key starts with one of these refreshes with it. */
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

/** Every entry change refreshes all of it, whichever way it arrives. */
const entryDerived = [keys.entries, keys.report, keys.trash, keys.projects, keys.tasks, keys.tags] as const;

/** The code that writes names the change, not the lists. */
export const stale = {
  /** Includes the timer state, which carries the running entry. */
  entries: [...entryDerived, keys.timer],
  /** A newer timer state started, stopped or discarded entries. */
  timerChanged: entryDerived,
  clients: [keys.clients, keys.projects, keys.entries, keys.timer, keys.report],
  projects: [keys.projects, keys.tasks, keys.entries, keys.timer, keys.report],
  projectDeleted: [keys.projects, keys.tasks, keys.entries, keys.timer, keys.report, keys.trash],
  projectSaved: [keys.projects, keys.clients, keys.tasks, keys.entries, keys.timer, keys.report],
  projectCreated: [keys.projects, keys.clients],
  clientCreated: [keys.clients],
  tasks: [keys.tasks, keys.entries, keys.timer, keys.report],
  tags: [keys.tags, keys.entries, keys.timer, keys.report],
  tagCreated: [keys.tags],
  /** Day boundaries depend on the timezone and week start. */
  profile: [keys.me, keys.entries, keys.timer, keys.report],
  credentials: [keys.me],
  /** Rounding and rates change reports and project amounts. */
  workspace: [keys.workspace, keys.report, keys.projects],
  imported: [keys.entries, keys.timer, keys.projects, keys.clients, keys.tags, keys.tasks, keys.report],
  trash: [keys.trash],
  /** Possibly the admin's own. */
  adminUser: [keys.adminUsers, keys.me],
  adminUsers: [keys.adminUsers],
  adminInvites: [keys.adminInvites],
  adminSettings: [keys.adminSettings],
} satisfies Record<string, readonly QueryKey[]>;
