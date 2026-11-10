/** As the Toggl v9 API and the JSON restore send them. */
import { isHexColor } from '@tokkl/common/colors';
import {
  MAX_CLIENT_NOTES_LENGTH,
  MAX_NAME_LENGTH,
  type ClientChanges,
  type ClientChoice,
  type ClientRestore,
  type NewClient,
  type NewProject,
  type NewTask,
  type ProjectChanges,
  type ProjectFields,
  type TaskChanges,
} from '../domain/catalogCommands.ts';
import { isCurrencyCode } from '../domain/workspaceValues.ts';
import { invalidInput } from '../lib/errors.ts';
import {
  optionalBool,
  optionalId,
  optionalNumber,
  optionalRate,
  optionalString,
  requireName,
  type JsonBody,
} from '../lib/values.ts';

const name = (value: unknown, label: string) => requireName(value, label, MAX_NAME_LENGTH);
const optionalName = (value: unknown, label: string) => (value === undefined ? undefined : name(value, label));
/** Absent stays absent; `null` clears. */
function clearable<T>(value: unknown, read: (value: unknown) => T | null | undefined): T | null | undefined {
  return value === undefined ? undefined : (read(value) ?? null);
}

const notes = (body: JsonBody) =>
  clearable(body.notes, value => optionalString(value, 'notes', MAX_CLIENT_NOTES_LENGTH));

export function parseNewClient(body: JsonBody): NewClient {
  return { name: name(body.name, 'Client name'), notes: notes(body) ?? null };
}

/** A non-boolean `archived` is ignored, as Toggl does. */
export function parseClientChanges(body: JsonBody): ClientChanges {
  return {
    name: optionalName(body.name, 'Client name'),
    notes: notes(body),
    archived: typeof body.archived === 'boolean' ? body.archived : undefined,
  };
}

export function parseClientRestore(body: JsonBody): ClientRestore {
  const allProjects = optionalBool(body.restore_all_projects, 'restore_all_projects') ?? false;
  const ids = body.projects ?? [];
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))
    throw invalidInput('Invalid projects');
  return { allProjects, projectIds: ids as number[] };
}

/** `client_id` (or Toggl's older `cid`), else `client_name`; an empty name means no change. */
function clientChoice(body: JsonBody): ClientChoice | undefined {
  const id = optionalId('client_id' in body ? body.client_id : body.cid, 'client_id');
  if (id !== undefined) return { id };
  const clientName = optionalString(body.client_name, 'client_name', MAX_NAME_LENGTH);
  return clientName ? { name: name(clientName, 'Client name') } : undefined;
}

function color(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isHexColor(value)) throw invalidInput('Invalid color: expected #rrggbb');
  return value.toLowerCase();
}

function date(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw invalidInput(`Invalid ${field}: expected YYYY-MM-DD`);
  return value;
}

function currency(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !isCurrencyCode(value))
    throw invalidInput('Invalid currency: expected an ISO 4217 code');
  return value.toUpperCase();
}

function projectFields(body: JsonBody): ProjectFields {
  return {
    client: clientChoice(body),
    color: color(body.color),
    active: optionalBool(body.active, 'active'),
    isPrivate: optionalBool(body.is_private, 'is_private'),
    billable: optionalBool(body.billable, 'billable'),
    estimatedHours: clearable(body.estimated_hours, value => optionalNumber(value, 'estimated_hours')),
    rate: clearable(body.rate, value => optionalRate(value, 'rate')),
    currency: currency(body.currency),
    fixedFee: clearable(body.fixed_fee, value => optionalNumber(value, 'fixed_fee')),
    startDate: date(body.start_date, 'start_date'),
    endDate: date(body.end_date, 'end_date'),
    template: optionalBool(body.template, 'template'),
  };
}

export function parseNewProject(body: JsonBody): NewProject {
  return { name: name(body.name, 'Project name'), ...projectFields(body) };
}

export function parseProjectChanges(body: JsonBody): ProjectChanges {
  return { name: optionalName(body.name, 'Project name'), ...projectFields(body) };
}

function taskFields(body: JsonBody) {
  return {
    active: optionalBool(body.active, 'active'),
    estimatedSeconds: optionalNumber(body.estimated_seconds, 'estimated_seconds'),
  };
}

export function parseNewTask(body: JsonBody): NewTask {
  return { name: name(body.name, 'Task name'), ...taskFields(body) };
}

export function parseTaskChanges(body: JsonBody): TaskChanges {
  return { name: optionalName(body.name, 'Task name'), ...taskFields(body) };
}

export function parseTagName(body: JsonBody): string {
  return name(body.name, 'Tag name');
}
