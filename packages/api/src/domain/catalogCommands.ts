/** Parsed by `commands/catalogs.ts`. Names are trimmed and non-blank; `null` clears a value that can be empty. */
import type { Id } from './model.ts';

export const MAX_NAME_LENGTH = 255;
export const MAX_CLIENT_NOTES_LENGTH = 10000;

export interface NewClient {
  name: string;
  notes: string | null;
}

export interface ClientChanges {
  name?: string;
  notes?: string | null;
  archived?: boolean;
}

export interface ClientRestore {
  allProjects: boolean;
  projectIds: Id[];
}

/** By id (`null` for none), or by name, created when missing. */
export type ClientChoice = { id: Id | null } | { name: string };

export interface ProjectFields {
  client?: ClientChoice;
  /** Lower-case #rrggbb. */
  color?: string;
  active?: boolean;
  isPrivate?: boolean;
  billable?: boolean;
  estimatedHours?: number | null;
  rate?: number | null;
  /** Upper-case ISO 4217 code. */
  currency?: string | null;
  fixedFee?: number | null;
  /** YYYY-MM-DD. */
  startDate?: string | null;
  endDate?: string | null;
  template?: boolean;
}

export interface NewProject extends ProjectFields {
  name: string;
}

export interface ProjectChanges extends ProjectFields {
  name?: string;
}

export interface NewTask {
  name: string;
  active?: boolean;
  estimatedSeconds?: number | null;
}

export interface TaskChanges {
  name?: string;
  active?: boolean;
  estimatedSeconds?: number | null;
}
