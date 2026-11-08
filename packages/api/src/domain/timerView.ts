/**
 * The timer as one user sees it: the running entry, the pause chain and the Pomodoro session at one
 * revision. Presenters turn a view into the `TimerState` clients read; the domain never does.
 */
import {
  plannedEnd,
  transitionKind,
  type PomodoroSessionConfig,
  type SessionPhase,
  type TransitionKind,
} from '@tokkl/common/pomodoroSession';
import type { TagsReader, TimersReader } from '../storage/contracts.ts';
import type {
  DiscardedPomodoro,
  EntryDetails,
  Id,
  PauseChain,
  TagLabel,
  TimerSnapshot,
  User,
} from '../storage/domain.ts';

export interface PomodoroView {
  config: PomodoroSessionConfig;
  phase: SessionPhase;
  plannedEnd: Date;
  transition: TransitionKind;
  /** The phase the transition leads to. */
  upcoming: SessionPhase['kind'];
  /** The Pomodoro's number: the current work phase counts itself. */
  number: number;
  entryId: Id;
  /** The running entry's start. */
  entryStart: string;
}

export interface TimerView {
  revision: number;
  /** The server clock the view was built at. */
  at: Date;
  /** The owner, whose name the running entry shows. */
  user: User;
  running: EntryDetails | null;
  /** The chain's tags that still exist, in the chain's order. */
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

/** The view of `snapshot`, or of the stored state when it is omitted. */
export async function buildTimerView(
  ctx: { timers: Pick<TimersReader, 'read'>; tags: Pick<TagsReader, 'findByIds'> },
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
