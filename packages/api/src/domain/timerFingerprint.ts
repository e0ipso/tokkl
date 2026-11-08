/**
 * The timer fingerprint: the text stored with each timer revision (`timer_revisions.fingerprint`).
 * Settlement compares it as a string to tell whether the visible state changed, so the encoding
 * must stay byte for byte what earlier servers stored. This module is the only place that writes
 * or reads it.
 */
import type { Id, TagLabel, TimerSnapshot } from '../storage/domain.ts';

const orderedTags = (tags: TagLabel[]) => [...tags].sort((a, b) => a.id - b.id).map(t => ({ id: t.id, name: t.name }));

/**
 * Encodes the canonical domain fields of `snapshot`, with `chainTags` the pause chain's tags as
 * stored. Audit and driver representations never number visible state.
 */
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

/** The fingerprint of a user with nothing running, no chain and no session: the state before revision 1. */
export const IDLE_TIMER_FINGERPRINT = encodeTimerFingerprint(
  { running: null, pauseChain: null, session: null, revision: null },
  [],
);

/** What settlement reads back from a stored fingerprint. */
export interface DecodedTimerFingerprint {
  /** The entry of the Pomodoro session the stored state showed; null when it showed none. */
  sessionEntryId: Id | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads a stored fingerprint. Text this module did not write reads as a state without a session:
 * the id only names a pomodoro the change sent to the trash, so an unreadable one must not stop
 * the timer from settling.
 */
export function decodeTimerFingerprint(text: string): DecodedTimerFingerprint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { sessionEntryId: null };
  }
  const session = isRecord(parsed) ? parsed.session : undefined;
  const entryId = isRecord(session) ? session.entryId : undefined;
  return { sessionEntryId: typeof entryId === 'number' && Number.isSafeInteger(entryId) ? entryId : null };
}
