/** Time entry bodies, as the Toggl v9 API and the importers send them, parsed into commands. */
import { parseDateKey } from '@tokkl/common/time';
import {
  MAX_CREATED_WITH_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  type EntryChanges,
  type EntryFields,
  type EntryPatchStep,
  type EntryTimes,
  type NewEntry,
  type TagAction,
} from '../domain/entryCommands.ts';
import { ApplicationError, invalidInput } from '../lib/errors.ts';
import { optionalBool, optionalId, optionalString, parseInstant, type JsonBody } from '../lib/values.ts';

const present = (value: unknown) => value !== undefined && value !== null;

function optionalInstant(value: unknown, field: string): Date | undefined {
  return present(value) ? parseInstant(value, field) : undefined;
}

function optionalDuration(value: unknown): number | undefined {
  if (!present(value)) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidInput('Invalid duration: expected an integer');
  return Math.trunc(value);
}

function optionalStartDate(value: unknown): string | undefined {
  if (!present(value)) return undefined;
  if (typeof value !== 'string' || !parseDateKey(value)) throw invalidInput('Invalid start_date: expected YYYY-MM-DD');
  return value;
}

/** `start` and `start_date`, and `start` moved to that day when both were sent. */
function readStart(body: JsonBody): Pick<EntryTimes, 'start' | 'startOnDate' | 'startDate'> {
  const start = optionalInstant(body.start, 'start');
  const startDate = optionalStartDate(body.start_date);
  const startOnDate =
    start && startDate ? parseInstant(`${startDate}${(body.start as string).slice(10)}`, 'start') : undefined;
  return { start, startOnDate, startDate };
}

/**
 * The times of an entry body. A new no-time entry without `start` ignores `stop`: its span comes
 * from `start_date` and `duration` alone.
 */
function readTimes(body: JsonBody, newNoTime = false): EntryTimes {
  const times: EntryTimes = { ...readStart(body), duration: optionalDuration(body.duration) };
  if (!newNoTime || times.start) times.stop = optionalInstant(body.stop, 'stop');
  return times;
}

function optionalTagIds(value: unknown): number[] | undefined {
  if (!present(value)) return undefined;
  if (!Array.isArray(value)) throw invalidInput('Invalid tag_ids: expected an array');
  return value.map(item => {
    const id = optionalId(item, 'tag_ids');
    if (!id) throw invalidInput('Invalid tag_ids');
    return id;
  });
}

function optionalTagNames(value: unknown): string[] | undefined {
  if (!present(value)) return undefined;
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string'))
    throw invalidInput('Invalid tags: expected an array of strings');
  return value as string[];
}

/** Toggl accepts `wid` as an older name of `workspace_id`. */
const readWorkspaceId = (body: JsonBody) => optionalId(body.workspace_id ?? body.wid, 'workspace_id');

/** The project, task, description, billable flag and tags. Entry bodies also take `pid` and `tid`. */
function readLabels(body: JsonBody, aliases: boolean): Omit<EntryFields, 'workspaceId'> {
  const project = aliases && body.project_id === undefined ? body.pid : body.project_id;
  const task = aliases && body.task_id === undefined ? body.tid : body.task_id;
  return {
    projectId: optionalId(project, 'project_id'),
    taskId: optionalId(task, 'task_id'),
    description: optionalString(body.description, 'description', MAX_DESCRIPTION_LENGTH),
    billable: optionalBool(body.billable, 'billable'),
    tagIds: optionalTagIds(body.tag_ids),
    tagNames: optionalTagNames(body.tags),
  };
}

const readCreatedWith = (body: JsonBody) => optionalString(body.created_with, 'created_with', MAX_CREATED_WITH_LENGTH);

/** The entry fields of a body that carries other things too, such as a Pomodoro start. */
export function parseEntryLabels(body: JsonBody): Omit<NewEntry, 'allDay' | 'times'> {
  return { ...readLabels(body, false), createdWith: readCreatedWith(body) };
}

export function parseNewEntry(body: JsonBody): NewEntry {
  const workspaceId = readWorkspaceId(body);
  const allDay = optionalBool(body.all_day, 'all_day') === true;
  const times = readTimes(body, allDay);
  return { workspaceId, allDay, times, ...readLabels(body, true), createdWith: readCreatedWith(body) };
}

function tagAction(value: unknown): TagAction {
  if (value === 'add') return 'add';
  return value === 'delete' || value === 'remove' ? 'delete' : 'replace';
}

export function parseEntryChanges(body: JsonBody): EntryChanges {
  const workspaceId = readWorkspaceId(body);
  const allDay = optionalBool(body.all_day, 'all_day');
  const times = readTimes(body);
  return { workspaceId, allDay, times, ...readLabels(body, true), tagAction: tagAction(body.tag_action) };
}

/** The `stop` of a stop request; the body is optional. */
export function parseStopAt(body: JsonBody | undefined): Date | undefined {
  return body?.stop === undefined ? undefined : parseInstant(body.stop, 'stop');
}

const PATCH_FIELDS: Readonly<Record<string, string>> = {
  '/description': 'description',
  '/project_id': 'project_id',
  '/pid': 'project_id',
  '/task_id': 'task_id',
  '/tid': 'task_id',
  '/billable': 'billable',
  '/start': 'start',
  '/stop': 'stop',
  '/duration': 'duration',
  '/tags': 'tags',
  '/tag_ids': 'tag_ids',
};

/** The update body one JSON Patch operation stands for. */
function operationBody(op: string, path: string, value: unknown): JsonBody {
  const field = PATCH_FIELDS[path];
  if (!field) throw invalidInput(`Unsupported path ${path}`);
  if (!['add', 'remove', 'replace'].includes(op)) throw invalidInput(`Unsupported operation ${op}`);
  if (field === 'tags' || field === 'tag_ids') {
    const action = op === 'add' ? 'add' : op === 'remove' ? 'delete' : undefined;
    const tags = op === 'remove' && value === undefined ? null : value;
    if (tags === null) return { [field]: [] };
    return { [field]: tags, tag_action: action };
  }
  if (op === 'remove') {
    if (field === 'description') return { description: '' };
    if (field === 'project_id' || field === 'task_id') return { [field]: null };
    throw invalidInput(`Cannot remove ${path}`);
  }
  return { [field]: value };
}

function refusal(error: unknown, afterLookup: boolean): EntryPatchStep['edit'] {
  if (error instanceof ApplicationError) return { ok: false, error, afterLookup };
  throw error;
}

function patchStep(raw: unknown): EntryPatchStep {
  const { op, path, value } = (raw ?? {}) as { op?: unknown; path?: unknown; value?: unknown };
  if (!raw || typeof op !== 'string' || typeof path !== 'string')
    return { touchesTimes: false, edit: refusal(invalidInput('Invalid patch operation'), false) };
  const touchesTimes = path === '/start' || path === '/stop';
  let body: JsonBody;
  try {
    body = operationBody(op, path, value);
  } catch (error) {
    return { touchesTimes, edit: refusal(error, false) };
  }
  try {
    return { touchesTimes, edit: { ok: true, changes: parseEntryChanges(body) } };
  } catch (error) {
    return { touchesTimes, edit: refusal(error, true) };
  }
}

/** A bulk edit: a non-empty array of JSON Patch operations. */
export function parseEntryPatch(operations: unknown[]): EntryPatchStep[] {
  if (operations.length === 0) throw invalidInput('Expected an array of patch operations');
  return operations.map(patchStep);
}
