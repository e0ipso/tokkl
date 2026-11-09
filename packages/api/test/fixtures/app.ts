import type { Express } from 'express';
import { createHttpApp, type HttpApp } from '../../src/app.ts';
import type { SetupState } from '../../src/auth/sessions.ts';
import type { Config } from '../../src/config.ts';
import type { Clock, Storage, TimerBus } from '../../src/domain/ports.ts';
import { systemClock } from '../../src/lib/clock.ts';
import { createLogger, type Logger } from '../../src/lib/logger.ts';
import { createReportRunner } from '../../src/reportRunners.ts';
import { createApplicationServices, type ApplicationServices } from '../../src/services/application.ts';
import type { ReportExecutor } from '../../src/services/reportRunner.ts';
import type { TimerStreamOptions } from '../../src/services/timerStreams.ts';
import { createLocalTimerBus } from '../../src/storage/timerBus.ts';

export interface TestAppOptions {
  storage: Storage;
  config: Config;
  setup: SetupState;
  /** Defaults to the single-process bus. The test owns its lifetime. */
  timerBus?: TimerBus;
  /** Defaults to JSON lines at `config.logLevel`. */
  logger?: Logger;
  /** Defaults to a runner on `config.storage`. Closing the app closes it. */
  reports?: ReportExecutor;
  /** Defaults to the system clock. */
  clock?: Clock;
  timerStreamOptions?: TimerStreamOptions;
}

/** The HTTP app and the services it serves, composed the way `index.ts` composes them. */
export interface TestApp extends HttpApp {
  services: ApplicationServices;
}

export function composeApp({
  storage,
  config,
  setup,
  timerBus = createLocalTimerBus(),
  logger = createLogger({ level: config.logLevel }),
  reports = createReportRunner(config.storage, storage, { logger }),
  clock = systemClock,
  timerStreamOptions,
}: TestAppOptions): TestApp {
  const services = createApplicationServices({
    storage,
    reports,
    bus: timerBus,
    clock,
    logger,
    sessionDays: config.sessionDays,
    streamOptions: timerStreamOptions,
  });
  return { ...createHttpApp(services, { storage, config, setup, logger }), services };
}

/** The Express app of `composeApp`, for tests that serve it and never call a service or close it. */
export function createApp(options: TestAppOptions): Express {
  return composeApp(options).app;
}
