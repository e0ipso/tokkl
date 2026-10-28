import express, { type Router } from 'express';
import { requireAuth, stillSignedIn } from '../auth/middleware.ts';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
import {
  discardPause, endPomodoro, getTimerState, nextPomodoroPhase, pauseTimer, resumeTimer, startPomodoro,
} from '../services/timerState.ts';

/**
 * The server-owned timer state, its actions and its event stream, under /api/app. Each action
 * returns the new state. A refused action is a 409 whose body is the current state.
 */
export function timerRoutes(deps: Deps): Router {
  const { db, timerStreams } = deps;
  const api = express.Router();
  const auth = requireAuth(deps);

  api.get('/timer', auth, (req, res) => res.json(getTimerState(db, res.locals.user)));

  /**
   * Server-Sent Events: one `timer` event with the full state on connect and after every change,
   * and a `keep-alive` event between them. The stream ends once the credential that opened it
   * stops signing the request in.
   */
  api.get('/timer/events', auth, (req, res) => {
    const { locals } = res;
    const { user } = locals;
    timerStreams.open(user.id, res, () => stillSignedIn(db, locals, user));
  });

  // Pause takes no fields, so any body or none is accepted.
  api.post('/timer/pause', auth, (req, res) => res.json(pauseTimer(db, res.locals.user)));
  api.post('/timer/resume', auth, (req, res) => res.json(resumeTimer(db, res.locals.user, readJson(req).revision)));
  api.post('/timer/discard', auth, (req, res) => res.json(discardPause(db, res.locals.user, readJson(req).revision)));

  api.post('/pomodoro', auth, (req, res) => res.json(startPomodoro(db, res.locals.user, readJson(req))));
  api.post('/pomodoro/next', auth, (req, res) => res.json(nextPomodoroPhase(db, res.locals.user, readJson(req).revision)));
  api.post('/pomodoro/end', auth, (req, res) => res.json(endPomodoro(db, res.locals.user, readJson(req).revision)));

  return api;
}
