import type { TimerState } from '@tokkl/types';
import { TimerRefusal, type TimerOperations } from '../domain/timers.ts';
import type { TimerView } from '../domain/timerView.ts';
import { StateConflict } from '../lib/errors.ts';
import { presentTimerState } from '../presenters/timer.ts';

/**
 * One user's timer operations as clients see them: each answer and each refusal carries a
 * `TimerState`.
 */
export type PresentedTimerOperations = {
  [Name in keyof TimerOperations]: (...args: Parameters<TimerOperations[Name]>) => Promise<TimerState>;
};

/** Presents a committed view, or a refusal's view, after the operation's transaction ended. */
async function presented(work: Promise<TimerView>): Promise<TimerState> {
  try {
    return presentTimerState(await work);
  } catch (error) {
    if (error instanceof TimerRefusal) throw new StateConflict(error.message, presentTimerState(error.state));
    throw error;
  }
}

/** Every timer operation answers a view. One that did not would fail to compile here. */
type ViewOperations = { [Name in keyof TimerOperations]: (...args: never[]) => Promise<TimerView> };

/** Wraps every operation of `operations`, so a new one needs no change here. */
export function presentTimerOperations(operations: TimerOperations): PresentedTimerOperations {
  const views: ViewOperations = operations;
  const wrapped = {} as Record<keyof TimerOperations, (...args: never[]) => Promise<TimerState>>;
  for (const name of Object.keys(views) as Array<keyof TimerOperations>)
    wrapped[name] = (...args) => presented(views[name](...args));
  return wrapped as PresentedTimerOperations;
}
