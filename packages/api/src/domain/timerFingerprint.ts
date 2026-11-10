/** Compared as a string per revision, so the encoding must stay byte for byte stable. Write-only. */
import type { TagLabel, TimerSnapshot } from './model.ts';

const orderedTags = (tags: TagLabel[]) => [...tags].sort((a, b) => a.id - b.id).map(t => ({ id: t.id, name: t.name }));

/** `chainTags` are the pause chain's tags as stored. */
export function encodeTimerFingerprint(snapshot: TimerSnapshot, chainTags: TagLabel[]): string {
  const e = snapshot.running,
    c = snapshot.pauseChain,
    s = snapshot.session;
  // Key order is part of the stored text: changing it would number every stored state anew.
  return JSON.stringify({
    running: e && {
      id: e.id,
      workspaceId: e.workspaceId,
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      start: e.start,
      billable: e.billable,
      tags: orderedTags(e.tags),
      project: e.project && {
        name: e.project.name,
        color: e.project.color,
        active: e.project.active,
        billable: e.project.billable,
      },
      client: e.client && { id: e.client.id, name: e.client.name },
      task: e.task && { name: e.task.name, active: e.task.active },
    },
    session: s && {
      userId: s.userId,
      entryId: s.entryId,
      config: {
        workMinutes: s.config.workMinutes,
        shortRestMinutes: s.config.shortRestMinutes,
        longRestMinutes: s.config.longRestMinutes,
        longRestEvery: s.config.longRestEvery,
      },
      phase: { kind: s.phase.kind, startedAt: s.phase.startedAt, completed: s.phase.completed },
    },
    chain: c && {
      userId: c.userId,
      workspaceId: c.workspaceId,
      projectId: c.projectId,
      taskId: c.taskId,
      description: c.description,
      tagIds: [...c.tagIds].sort((a, b) => a - b),
      billable: c.billable,
      seconds: c.seconds,
      cloneEntryId: c.cloneEntryId,
      tags: orderedTags(chainTags),
    },
  });
}

/** The state before revision 1. */
export const IDLE_TIMER_FINGERPRINT = encodeTimerFingerprint(
  { running: null, pauseChain: null, session: null, revision: null },
  [],
);
