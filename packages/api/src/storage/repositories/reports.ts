import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { ReportOrder, Repositories, ReportSelection } from '../../domain/ports.ts';
import type { ReportEntryProjection, TagLabel } from '../../domain/model.ts';
import { booleanValue, entityId, finiteNumber, safeInteger, utcInstant } from '../conversion.ts';
import { reportContains, reportDuration, reportIds, reportRoundedSeconds, reportTags } from './report-sql.ts';

const nullableId = (v: number | string | null) => (v === null ? null : entityId(v));

export function createReportRepositories(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
): Pick<Repositories, 'reports'> {
  const selected = (userId: number, workspaceId: number, f: ReportSelection) => {
    let q = db
      .selectFrom('time_entries as e')
      .leftJoin('projects as p', 'p.id', 'e.project_id')
      .leftJoin('clients as c', 'c.id', 'p.client_id')
      .leftJoin('tasks as t', 't.id', 'e.task_id')
      .where('e.user_id', '=', userId)
      .where('e.workspace_id', '=', workspaceId)
      .where('e.start', '>=', f.from)
      .where('e.start', '<', f.to)
      .where('e.stop', 'is not', null)
      .where('e.deleted_at', 'is', null);
    for (const clause of [
      reportIds('e.project_id', f.projectIds),
      reportIds('p.client_id', f.clientIds),
      reportIds('e.task_id', f.taskIds),
      reportIds('e.user_id', f.userIds),
      reportTags(f.tagIds),
    ])
      if (clause) q = q.where(clause);
    for (const clause of [
      reportIds('e.project_id', f.excludeProjectIds),
      reportIds('p.client_id', f.excludeClientIds),
      reportTags(f.excludeTagIds),
    ]) {
      if (clause) q = q.where(sql<boolean>`not coalesce(${clause}, false)`);
    }
    if (f.minDurationSeconds !== undefined) q = q.where(reportDuration(backend), '>=', f.minDurationSeconds);
    if (f.maxDurationSeconds !== undefined) q = q.where(reportDuration(backend), '<=', f.maxDurationSeconds);
    if (f.timeEntryIds?.length) q = q.where('e.id', 'in', f.timeEntryIds);
    if (f.billable !== undefined) q = q.where('e.billable', '=', Number(f.billable));
    if (f.description) q = q.where(reportContains(backend, f.description));
    return q;
  };
  type Selection = ReturnType<typeof selected>;
  const entryRows = (q: Selection) =>
    q
      .select([
        'e.id',
        'e.user_id',
        'e.workspace_id',
        'e.description',
        'e.start',
        'e.stop',
        'e.updated_at',
        'e.billable',
        'e.all_day',
        'e.project_id',
        'e.task_id',
        'p.name as project_name',
        'p.color as project_color',
        'p.rate as project_rate',
        'p.currency as project_currency',
        'c.id as client_id',
        'c.name as client_name',
        't.name as task_name',
      ])
      .execute();
  type EntryRow = Awaited<ReturnType<typeof entryRows>>[number];
  const entryTags = async (ids: readonly number[]): Promise<Map<number, TagLabel[]>> => {
    const tags = new Map<number, TagLabel[]>();
    if (!ids.length) return tags;
    const labels = await db
      .selectFrom('time_entry_tags as et')
      .innerJoin('tags as g', 'g.id', 'et.tag_id')
      .select(['et.time_entry_id', 'g.id', 'g.name'])
      .where('et.time_entry_id', 'in', ids)
      .orderBy('g.name_key')
      .orderBy('g.id')
      .execute();
    for (const r of labels) {
      const id = entityId(r.time_entry_id),
        list = tags.get(id) ?? [];
      list.push({ id: entityId(r.id), name: r.name });
      tags.set(id, list);
    }
    return tags;
  };
  const reportEntry = (r: EntryRow, tags: Map<number, TagLabel[]>): ReportEntryProjection => ({
    id: entityId(r.id),
    userId: entityId(r.user_id),
    workspaceId: entityId(r.workspace_id),
    description: r.description,
    start: utcInstant(r.start),
    stop: utcInstant(r.stop),
    updatedAt: utcInstant(r.updated_at),
    billable: booleanValue(r.billable),
    allDay: booleanValue(r.all_day),
    projectId: nullableId(r.project_id),
    taskId: nullableId(r.task_id),
    projectName: r.project_name,
    projectColor: r.project_color,
    projectRate: r.project_rate === null ? null : finiteNumber(r.project_rate),
    projectCurrency: r.project_currency,
    clientId: nullableId(r.client_id),
    clientName: r.client_name,
    taskName: r.task_name,
    tags: tags.get(entityId(r.id)) ?? [],
  });
  const withTags = async (rows: EntryRow[]) => {
    const tags = await entryTags(rows.map(r => entityId(r.id)));
    return rows.map(r => reportEntry(r, tags));
  };
  const orderKey = (order: ReportOrder) =>
    order.by === 'start'
      ? sql.ref('e.start')
      : order.by === 'updated'
        ? sql.ref('e.updated_at')
        : reportRoundedSeconds(backend, order.rounding);
  const count = (expression: RawBuilder<unknown>) => sql<number | string | null>`coalesce(sum(${expression}), 0)`;
  return {
    reports: {
      async count(userId, workspaceId, selection) {
        const row = await selected(userId, workspaceId, selection)
          .select([
            sql<number | string>`count(*)`.as('entries'),
            count(sql`case when e.billable = 1 then 1 else 0 end`).as('billable'),
            count(sql`case when e.billable = 1 and p.rate is not null then 1 else 0 end`).as('rated'),
          ])
          .executeTakeFirstOrThrow();
        return {
          entries: safeInteger(Number(row.entries)),
          billable: safeInteger(Number(row.billable)),
          billableWithProjectRate: safeInteger(Number(row.rated)),
        };
      },
      async ids(userId, workspaceId, selection, order, window) {
        const direction = order.direction === 'ASC' ? 'asc' : 'desc';
        let q = selected(userId, workspaceId, selection)
          .select('e.id')
          .orderBy(orderKey(order), direction)
          .orderBy('e.id', direction);
        if (window) q = q.limit(window.limit).offset(window.offset);
        return (await q.execute()).map(r => entityId(r.id));
      },
      async descriptions(userId, workspaceId, selection) {
        const rows = await selected(userId, workspaceId, selection).select(['e.id', 'e.description']).execute();
        return rows.map(r => ({ id: entityId(r.id), description: r.description }));
      },
      async entries(userId, workspaceId, selection, ids) {
        if (!ids.length) return [];
        const found = new Map(
          (await withTags(await entryRows(selected(userId, workspaceId, selection).where('e.id', 'in', ids)))).map(
            entry => [entry.id, entry],
          ),
        );
        return ids.flatMap(id => found.get(id) ?? []);
      },
      async batch(userId, workspaceId, selection, after, limit) {
        let q = selected(userId, workspaceId, selection);
        if (after)
          q = q.where(eb =>
            eb.or([
              eb('e.start', '>', after.start),
              eb.and([eb('e.start', '=', after.start), eb('e.id', '>', after.id)]),
            ]),
          );
        return withTags(await entryRows(q.orderBy('e.start').orderBy('e.id').limit(limit)));
      },
    },
  };
}
