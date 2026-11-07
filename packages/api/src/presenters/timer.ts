/** The `TimerState` that timer routes answer with and timer streams send. */
import type { TimerState } from '@tokkl/types';
import type { TimerView } from '../domain/timerView.ts';
import { serializeTimeEntry } from './toggl.ts';

export function presentTimerState(view: TimerView): TimerState {
  const { pause, pomodoro, running } = view;
  return {
    revision: view.revision,
    server_time: view.at.toISOString(),
    running_entry: running ? serializeTimeEntry(running, { meta: true, user: view.user }) : null,
    pause: pause && {
      paused: pause.chain.cloneEntryId === null,
      seconds: pause.chain.seconds,
      workspace_id: pause.chain.workspaceId,
      description: pause.chain.description,
      project_id: pause.chain.projectId,
      task_id: pause.chain.taskId,
      tag_ids: pause.tags.map(tag => tag.id),
      tags: pause.tags.map(tag => tag.name),
      billable: pause.chain.billable,
      clone_entry_id: pause.chain.cloneEntryId,
    },
    pomodoro: pomodoro && {
      work_minutes: pomodoro.config.workMinutes,
      short_rest_minutes: pomodoro.config.shortRestMinutes,
      long_rest_minutes: pomodoro.config.longRestMinutes,
      long_rest_every: pomodoro.config.longRestEvery,
      phase: {
        kind: pomodoro.phase.kind,
        start: pomodoro.phase.startedAt.toISOString(),
        completed: pomodoro.phase.completed,
        planned_end: pomodoro.plannedEnd.toISOString(),
      },
      upcoming_phase: pomodoro.upcoming,
      transition: pomodoro.transition,
      number: pomodoro.number,
      entry_id: pomodoro.entryId,
      pomodoro_start: pomodoro.entryStart,
    },
    discarded_pomodoro: view.discardedPomodoro && {
      entry_id: view.discardedPomodoro.entryId,
      start: view.discardedPomodoro.start,
      stop: view.discardedPomodoro.stop,
    },
  };
}
