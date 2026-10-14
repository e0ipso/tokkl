import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { createClient, setClientArchived } from '../models/clients.ts';
import { createProject } from '../models/projects.ts';
import { resolveTagNames } from '../models/tags.ts';
import { createTask } from '../models/tasks.ts';
import { createTimeEntry } from '../models/timeEntries.ts';
import type { UserRow } from '../models/users.ts';

export interface JsonImportResult {
  dry_run: boolean;
  clients: number;
  projects: number;
  tasks: number;
  tags: number;
  time_entries: number;
  skipped_duplicates: number;
  errors: Array<{ entity: string; id: unknown; message: string }>;
}

type Item = Record<string, unknown>;

function list(value: unknown, field: string): Item[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest(`Invalid export file: "${field}" must be an array`);
  return value.filter((item): item is Item => typeof item === 'object' && item !== null);
}

const MAX_ERRORS = 100;
class Rollback extends Error {}

/**
 * Restores a file written by GET /api/app/export.json into the current account. Clients, projects,
 * tasks and tags are matched by name (created when missing); entries that already exist with the
 * same start, stop, description and project are skipped, so restoring twice changes nothing.
 * Running entries in the file are imported as running only if nothing runs here.
 */
export function importJsonExport(db: Db, user: UserRow, data: unknown, options: { dryRun: boolean }): JsonImportResult {
  if (typeof data !== 'object' || data === null || (data as Item).format !== 'timetrack-export') {
    throw badRequest('This is not a Timetrack JSON export');
  }
  const file = data as Item;
  const wid = user.default_workspace_id;
  const result: JsonImportResult = {
    dry_run: options.dryRun, clients: 0, projects: 0, tasks: 0, tags: 0, time_entries: 0, skipped_duplicates: 0, errors: [],
  };
  const fail = (entity: string, id: unknown, error: unknown) => {
    if (result.errors.length < MAX_ERRORS) {
      result.errors.push({ entity, id, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const clientIds = new Map<number, number>();
  const projectIds = new Map<number, number>();
  const taskIds = new Map<number, number>();
  const tagIds = new Map<number, number>();
  const findId = (sql: string, ...params: Array<string | number>) =>
    (db.prepare(sql).get(...params) as { id: number } | undefined)?.id;

  const run = () => {
    for (const client of list(file.clients, 'clients')) {
      try {
        const name = String(client.name ?? '');
        let id = findId('SELECT id FROM clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE', wid, name);
        if (id === undefined) {
          id = createClient(db, wid, { name, notes: client.notes ?? null }).id;
          if (client.archived === true) setClientArchived(db, wid, id, true);
          result.clients++;
        }
        clientIds.set(Number(client.id), id);
      } catch (error) {
        fail('client', client.id, error);
      }
    }

    for (const project of list(file.projects, 'projects')) {
      try {
        const name = String(project.name ?? '');
        const clientId = project.client_id == null ? null : clientIds.get(Number(project.client_id)) ?? null;
        let id = findId(
          'SELECT id FROM projects WHERE workspace_id = ? AND IFNULL(client_id, 0) = ? AND name = ? COLLATE NOCASE',
          wid, clientId ?? 0, name,
        );
        if (id === undefined) {
          id = createProject(db, wid, {
            name, client_id: clientId, color: project.color, active: project.active, billable: project.billable,
            estimated_hours: project.estimated_hours, rate: project.rate, currency: project.currency,
            fixed_fee: project.fixed_fee, start_date: project.start_date, end_date: project.end_date,
            is_private: project.is_private, template: project.template,
          }).id;
          result.projects++;
        }
        projectIds.set(Number(project.id), id);
      } catch (error) {
        fail('project', project.id, error);
      }
    }

    for (const task of list(file.tasks, 'tasks')) {
      try {
        const projectId = projectIds.get(Number(task.project_id));
        if (projectId === undefined) throw new Error('Its project was not imported');
        const name = String(task.name ?? '');
        let id = findId('SELECT id FROM tasks WHERE project_id = ? AND name = ? COLLATE NOCASE', projectId, name);
        if (id === undefined) {
          // Tasks of archived projects cannot be created, so create them first and archive afterwards.
          const archived = db.prepare('SELECT active FROM projects WHERE id = ?').get(projectId) as { active: number };
          if (!archived.active) db.prepare('UPDATE projects SET active = 1 WHERE id = ?').run(projectId);
          id = createTask(db, wid, projectId, { name, active: task.active, estimated_seconds: task.estimated_seconds }).id;
          if (!archived.active) db.prepare('UPDATE projects SET active = 0 WHERE id = ?').run(projectId);
          result.tasks++;
        }
        taskIds.set(Number(task.id), id);
      } catch (error) {
        fail('task', task.id, error);
      }
    }

    for (const tag of list(file.tags, 'tags')) {
      try {
        const before = findId('SELECT id FROM tags WHERE workspace_id = ? AND name = ? COLLATE NOCASE', wid, String(tag.name ?? ''));
        const [id] = resolveTagNames(db, wid, [String(tag.name ?? '')]);
        if (before === undefined) result.tags++;
        tagIds.set(Number(tag.id), id!);
      } catch (error) {
        fail('tag', tag.id, error);
      }
    }

    const duplicate = db.prepare(`
      SELECT 1 FROM time_entries WHERE user_id = ? AND deleted_at IS NULL AND start = ? AND IFNULL(stop, '') = ?
        AND description = ? AND IFNULL(project_id, 0) = ?
    `);
    for (const entry of list(file.time_entries, 'time_entries')) {
      db.exec('SAVEPOINT import_entry');
      try {
        if (entry.server_deleted_at) {
          db.exec('RELEASE import_entry');
          continue;
        }
        const start = new Date(String(entry.start));
        const stop = entry.stop ? new Date(String(entry.stop)) : null;
        if (Number.isNaN(start.getTime()) || (stop && Number.isNaN(stop.getTime()))) throw new Error('Invalid start or stop');
        const projectId = entry.project_id == null ? null : projectIds.get(Number(entry.project_id)) ?? null;
        const description = typeof entry.description === 'string' ? entry.description : '';
        if (duplicate.get(user.id, start.toISOString(), stop?.toISOString() ?? '', description, projectId ?? 0)) {
          result.skipped_duplicates++;
          db.exec('RELEASE import_entry');
          continue;
        }
        const running = !stop && Boolean(db.prepare(
          'SELECT 1 FROM time_entries WHERE user_id = ? AND stop IS NULL AND deleted_at IS NULL',
        ).get(user.id));
        createTimeEntry(db, user, wid, {
          description,
          start: start.toISOString(),
          ...(stop ? { stop: stop.toISOString() } : running ? { stop: new Date().toISOString() } : { duration: -1 }),
          project_id: projectId,
          task_id: entry.task_id == null ? null : taskIds.get(Number(entry.task_id)) ?? null,
          billable: entry.billable === true,
          tag_ids: Array.isArray(entry.tag_ids)
            ? entry.tag_ids.map((id) => tagIds.get(Number(id))).filter((id): id is number => id !== undefined)
            : [],
          created_with: typeof entry.created_with === 'string' ? entry.created_with : 'timetrack-json-import',
        });
        result.time_entries++;
        db.exec('RELEASE import_entry');
      } catch (error) {
        db.exec('ROLLBACK TO import_entry');
        db.exec('RELEASE import_entry');
        fail('time_entry', entry.id, error);
      }
    }
  };

  try {
    transaction(db, () => {
      run();
      if (options.dryRun) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
