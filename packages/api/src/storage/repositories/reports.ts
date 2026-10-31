import { sql, type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories, ReportSelection } from '../contracts.ts';
import type { TagLabel } from '../domain.ts';
import { booleanValue, entityId, finiteNumber, utcInstant } from '../conversion.ts';
import { reportContains, reportDuration, reportIds, reportTags } from './report-sql.ts';

export function createReportRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): Pick<Repositories, 'reports'> {
  const selected = (userId: number, workspaceId: number, f: ReportSelection) => {
    let q = db.selectFrom('time_entries as e').leftJoin('projects as p', 'p.id', 'e.project_id')
      .leftJoin('clients as c', 'c.id', 'p.client_id').leftJoin('tasks as t', 't.id', 'e.task_id')
      .where('e.user_id', '=', userId).where('e.workspace_id', '=', workspaceId)
      .where('e.start', '>=', f.from).where('e.start', '<', f.to).where('e.stop', 'is not', null).where('e.deleted_at', 'is', null);
    for (const clause of [reportIds('e.project_id', f.projectIds), reportIds('p.client_id', f.clientIds),
      reportIds('e.task_id', f.taskIds), reportIds('e.user_id', f.userIds), reportTags(f.tagIds)]) if (clause) q = q.where(clause);
    for (const clause of [reportIds('e.project_id', f.excludeProjectIds), reportIds('p.client_id', f.excludeClientIds), reportTags(f.excludeTagIds)]) {
      if (clause) q = q.where(sql<boolean>`not coalesce(${clause}, false)`);
    }
    if (f.minDurationSeconds !== undefined) q = q.where(reportDuration(backend), '>=', f.minDurationSeconds);
    if (f.maxDurationSeconds !== undefined) q = q.where(reportDuration(backend), '<=', f.maxDurationSeconds);
    if (f.timeEntryIds?.length) q = q.where('e.id', 'in', f.timeEntryIds);
    if (f.billable !== undefined) q = q.where('e.billable', '=', Number(f.billable));
    if (f.description) q = q.where(reportContains(backend, f.description));
    return q;
  };
  return { reports: {
    async collect(userId, workspaceId, selection) {
      const q = selected(userId, workspaceId, selection);
      const rows = await q.select(['e.id', 'e.user_id', 'e.workspace_id', 'e.description', 'e.start', 'e.stop', 'e.updated_at',
        'e.billable', 'e.all_day', 'e.project_id', 'e.task_id', 'p.name as project_name', 'p.color as project_color',
        'p.rate as project_rate', 'p.currency as project_currency', 'c.id as client_id', 'c.name as client_name', 't.name as task_name'])
        .orderBy('e.start').orderBy('e.id').execute();
      // Reuse the relational selection, not an unbounded IN list or one tag lookup per entry.
      const labels = await db.selectFrom('time_entry_tags as et').innerJoin('tags as g', 'g.id', 'et.tag_id')
        .select(['et.time_entry_id', 'g.id', 'g.name']).where('et.time_entry_id', 'in', q.select('e.id'))
        .orderBy('g.name_key').orderBy('g.id').execute();
      const tags = new Map<number, TagLabel[]>();
      for (const r of labels) {
        const id = entityId(r.time_entry_id), list = tags.get(id) ?? [];
        list.push({ id: entityId(r.id), name: r.name }); tags.set(id, list);
      }
      const nullableId = (v: number | string | null) => v === null ? null : entityId(v);
      return rows.map(r => ({ id: entityId(r.id), userId: entityId(r.user_id), workspaceId: entityId(r.workspace_id),
        description: r.description, start: utcInstant(r.start), stop: utcInstant(r.stop), updatedAt: utcInstant(r.updated_at),
        billable: booleanValue(r.billable), allDay: booleanValue(r.all_day), projectId: nullableId(r.project_id),
        taskId: nullableId(r.task_id), projectName: r.project_name, projectColor: r.project_color,
        projectRate: r.project_rate === null ? null : finiteNumber(r.project_rate), projectCurrency: r.project_currency,
        clientId: nullableId(r.client_id), clientName: r.client_name, taskName: r.task_name, tags: tags.get(entityId(r.id)) ?? [] }));
    },
  } };
}
