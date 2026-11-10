/** Presenters turn a view into the `TimerState` clients read; the domain never does. */
import {
  plannedEnd,
  transitionKind,
  type PomodoroSessionConfig,
  type SessionPhase,
  type TransitionKind,
} from '@tokkl/common/pomodoroSession';
import type { TagsRepository, TimersRepository } from './ports.ts';
import type { DiscardedPomodoro, EntryDetails, Id, PauseChain, TagLabel, TimerSnapshot, User } from './model.ts';

interface PomodoroView {
  config: PomodoroSessionConfig;
  phase: SessionPhase;
  plannedEnd: Date;
  transition: TransitionKind;
  upcoming: SessionPhase['kind'];
  /** The current work phase counts itself. */
  number: number;
  entryId: Id;
  entryStart: string;
}

export interface TimerView {
  revision: number;
  at: Date;
  user: User;
  running: EntryDetails | null;
  /** Tags that still exist, in the chain's order. */
  pause: { chain: PauseChain; tags: TagLabel[] } | null;
  pomodoro: PomodoroView | null;
  discardedPomodoro: DiscardedPomodoro | null;
}

const UPCOMING: Readonly<Record<TransitionKind, SessionPhase['kind']>> = {
  workToShortRest: 'shortRest',
  workToLongRest: 'longRest',
  shortRestToWork: 'work',
  longRestToWork: 'work',
};

function pomodoroView(snapshot: TimerSnapshot): PomodoroView | null {
  const { session, running } = snapshot;
  if (!session) return null;
  const phase: SessionPhase = {
    kind: session.phase.kind,
    startedAt: new Date(session.phase.startedAt),
    completed: session.phase.completed,
  };
  const transition = transitionKind(phase, session.config);
  if (!running) return null;
  return {
    config: session.config,
    phase,
    plannedEnd: plannedEnd(phase, session.config),
    transition,
    upcoming: UPCOMING[transition],
    number: phase.kind === 'work' ? phase.completed + 1 : phase.completed,
    entryId: session.entryId,
    entryStart: running.start,
  };
}

/** Of the stored state when `snapshot` is omitted. */
export async function buildTimerView(
  ctx: { timers: Pick<TimersRepository, 'read'>; tags: Pick<TagsRepository, 'findByIds'> },
  user: User,
  at = new Date(),
  snapshot?: TimerSnapshot,
): Promise<TimerView> {
  const data = snapshot ?? (await ctx.timers.read(user.id));
  const chain = data.pauseChain;
  const tags = chain ? await ctx.tags.findByIds(chain.workspaceId, chain.tagIds) : [];
  return {
    revision: data.revision?.revision ?? 0,
    at,
    user,
    running: data.running,
    pause: chain && { chain, tags: tags.map(tag => ({ id: tag.id, name: tag.name })) },
    pomodoro: pomodoroView(data),
    discardedPomodoro: data.revision?.discardedPomodoro ?? null,
  };
}
