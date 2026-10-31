import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../contracts.ts';
import { booleanValue, entityId, safeInteger, utcInstant, jsonValue } from '../conversion.ts';
import { createEntryRepositories } from './entries.ts';

export function createTimerRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): Pick<Repositories, 'timers'> {
  const { entries } = createEntryRepositories(db, backend);
  const timers: Repositories['timers'] = {
    async read(userId) { return { running: await entries.running(userId) ?? null, pauseChain: await timers.getPauseChain(userId) ?? null,
      session: await timers.getSession(userId) ?? null, revision: await timers.getRevision(userId) ?? null }; },
    async getSession(userId) {
      const r = await db.selectFrom('pomodoro_sessions').selectAll().where('user_id', '=', userId).executeTakeFirst();
      if (!r) return;
      if (!['work', 'shortRest', 'longRest'].includes(r.phase_kind)) throw new Error('Invalid storage phase');
      return { userId: entityId(r.user_id), entryId: entityId(r.entry_id),
        config: { workMinutes: safeInteger(r.work_minutes), shortRestMinutes: safeInteger(r.short_rest_minutes), longRestMinutes: safeInteger(r.long_rest_minutes), longRestEvery: safeInteger(r.long_rest_every) },
        phase: { kind: r.phase_kind as 'work' | 'shortRest' | 'longRest', startedAt: utcInstant(r.phase_start), completed: safeInteger(r.completed) } };
    },
    async saveSession(s) {
      const row = { user_id: s.userId, entry_id: s.entryId, work_minutes: s.config.workMinutes, short_rest_minutes: s.config.shortRestMinutes,
        long_rest_minutes: s.config.longRestMinutes, long_rest_every: s.config.longRestEvery, phase_kind: s.phase.kind, phase_start: s.phase.startedAt, completed: s.phase.completed };
      const q = db.insertInto('pomodoro_sessions').values(row);
      await (backend === 'mysql' || backend === 'mariadb' ? q.onDuplicateKeyUpdate(row) : q.onConflict(c => c.column('user_id').doUpdateSet(row))).execute();
    },
    async deleteSession(userId) { await db.deleteFrom('pomodoro_sessions').where('user_id', '=', userId).execute(); },
    async getPauseChain(userId) {
      const r = await db.selectFrom('pause_chains').selectAll().where('user_id', '=', userId).executeTakeFirst();
      if (!r) return;
      const tags = jsonValue(r.tag_ids_json); if (!Array.isArray(tags)) throw new Error('Invalid storage tags');
      return { userId: entityId(r.user_id), workspaceId: entityId(r.workspace_id), projectId: r.project_id === null ? null : entityId(r.project_id),
        taskId: r.task_id === null ? null : entityId(r.task_id), description: r.description, tagIds: [...new Set(tags.map(entityId))].sort((a,b) => a-b),
        billable: booleanValue(r.billable), seconds: safeInteger(r.seconds), cloneEntryId: r.clone_entry_id === null ? null : entityId(r.clone_entry_id) };
    },
    async savePauseChain(c) {
      const row = { user_id: c.userId, workspace_id: c.workspaceId, project_id: c.projectId, task_id: c.taskId, description: c.description,
        tag_ids_json: JSON.stringify([...new Set(c.tagIds)].sort((a,b) => a-b)), billable: Number(c.billable), seconds: c.seconds, clone_entry_id: c.cloneEntryId };
      const q = db.insertInto('pause_chains').values(row);
      await (backend === 'mysql' || backend === 'mariadb' ? q.onDuplicateKeyUpdate(row) : q.onConflict(x => x.column('user_id').doUpdateSet(row))).execute();
    },
    async deletePauseChain(userId) { await db.deleteFrom('pause_chains').where('user_id', '=', userId).execute(); },
    async removeTagFromPauseChains(tagId) {
      // Called under the tag workspace and affected-user guards. Limit to that workspace.
      const tag = await db.selectFrom('tags').select('workspace_id').where('id', '=', tagId).executeTakeFirst();
      if (!tag) return;
      const rows = await db.selectFrom('pause_chains').select(['user_id', 'tag_ids_json']).where('workspace_id', '=', entityId(tag.workspace_id)).execute();
      for (const r of rows) {
        const tags = jsonValue(r.tag_ids_json); if (!Array.isArray(tags)) throw new Error('Invalid storage tags');
        const ids = tags.map(entityId);
        if (ids.includes(tagId)) await db.updateTable('pause_chains').set({ tag_ids_json: JSON.stringify(ids.filter(id => id !== tagId).sort((a,b) => a-b)) }).where('user_id', '=', entityId(r.user_id)).execute();
      }
    },
    async getRevision(userId) {
      const r = await db.selectFrom('timer_states').selectAll().where('user_id', '=', userId).executeTakeFirst();
      return r && { userId: entityId(r.user_id), revision: safeInteger(r.revision), fingerprint: r.fingerprint,
        discardedPomodoro: r.discarded_entry_id === null ? null : { entryId: entityId(r.discarded_entry_id), start: utcInstant(r.discarded_start), stop: utcInstant(r.discarded_stop) } };
    },
    async saveRevision(r) {
      const row = { user_id: r.userId, revision: r.revision, fingerprint: r.fingerprint, discarded_entry_id: r.discardedPomodoro?.entryId ?? null,
        discarded_start: r.discardedPomodoro?.start ?? null, discarded_stop: r.discardedPomodoro?.stop ?? null };
      const q = db.insertInto('timer_states').values(row);
      await (backend === 'mysql' || backend === 'mariadb' ? q.onDuplicateKeyUpdate(row) : q.onConflict(x => x.column('user_id').doUpdateSet(row))).execute();
    },
    async affectedUsers(wid) {
      let running = db.selectFrom('time_entries').select('user_id').where('workspace_id', '=', wid).where('stop', 'is', null).where('deleted_at', 'is', null);
      if (backend === 'mysql' || backend === 'mariadb') running = running.where('running_user_id', 'is not', null);
      const rows = await running.union(db.selectFrom('pause_chains').select('user_id').where('workspace_id', '=', wid)).execute();
      return [...new Set(rows.map(r => entityId(r.user_id)))].sort((a,b) => a-b);
    },
  };
  return { timers };
}
