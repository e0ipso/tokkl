import express, { type Router } from 'express';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
export function timerRoutes(deps: Deps): Router {
  const api = express.Router(), auth = deps.auth.requireAuth;
  api.get('/timer', auth, async (_req, res) => res.json(await deps.timersFor(res.locals.auth).getTimerState(res.locals.auth.user.id)));
  api.get('/timer/events', auth, async (_req, res) => {
    await deps.timerStreams.open(res.locals.auth.user.id, res, deps.auth.credentialCheck(res.locals.auth));
  });
  api.post('/timer/pause', auth, async (_req, res) => res.json(await deps.timersFor(res.locals.auth).pauseTimer(res.locals.auth.user.id)));
  api.post('/timer/resume', auth, async (req, res) => res.json(await deps.timersFor(res.locals.auth).resumeTimer(res.locals.auth.user.id, readJson(req).revision)));
  api.post('/timer/discard', auth, async (req, res) => res.json(await deps.timersFor(res.locals.auth).discardPause(res.locals.auth.user.id, readJson(req).revision)));
  api.post('/pomodoro', auth, async (req, res) => res.json(await deps.timersFor(res.locals.auth).startPomodoro(res.locals.auth.user.id, readJson(req))));
  api.post('/pomodoro/next', auth, async (req, res) => res.json(await deps.timersFor(res.locals.auth).nextPomodoroPhase(res.locals.auth.user.id, readJson(req).revision)));
  api.post('/pomodoro/end', auth, async (req, res) => res.json(await deps.timersFor(res.locals.auth).endPomodoro(res.locals.auth.user.id, readJson(req).revision)));
  return api;
}
