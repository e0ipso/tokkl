import type { Express } from 'express';
import { createApplication, type AppOptions } from '../../src/app.ts';

/** The Express app of `createApplication`, for tests that serve it and never call a service directly. */
export function createApp(options: AppOptions): Express {
  return createApplication(options).app;
}
