import type { Express } from 'express';
import { createHttpApp, type HttpApp } from '../../src/app.ts';
import type { SetupState } from '../../src/auth/sessions.ts';
import type { Config } from '../../src/config.ts';
import type { Clock, Storage, TimerBus } from '../../src/domain/ports.ts';
import { systemClock } from '../../src/lib/clock.ts';
import { createLogger, type Logger } from '../../src/lib/logger.ts';
import { createReportRunner } from '../../src/reportRunners.ts';
import {
  createApplicationServices,
  DEFAULT_SERVICE_SETTINGS,
  type ApplicationServices,
  type ServiceSettings,
} from '../../src/services/application.ts';
import type { ReportExecutor } from '../../src/services/reportRunner.ts';
import type { TimerStreamLimits } from '../../src/services/timerStreams.ts';
import { createLocalTimerBus } from '../../src/storage/timerBus.ts';

export interface TestAppOptions {
  storage: Storage;
  config: Config;
  setup: SetupState;
  /** Defaults to the single-process bus. The test owns its lifetime. */
  timerBus?: TimerBus;
  logger?: Logger;
  /** Defaults to a runner on `config.storage`. Closing the app closes it. */
  reports?: ReportExecutor;
  clock?: Clock;
  settings?: ServiceSettings;
}

export function streamSettings(limits: Partial<TimerStreamLimits>): ServiceSettings {
  return { ...DEFAULT_SERVICE_SETTINGS, timerStreams: { ...DEFAULT_SERVICE_SETTINGS.timerStreams, ...limits } };
}

/** Composed the way `index.ts` composes them. */
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
  settings = DEFAULT_SERVICE_SETTINGS,
}: TestAppOptions): TestApp {
  const services = createApplicationServices({
    storage,
    reports,
    settings,
    bus: timerBus,
    clock,
    logger,
    sessionDays: config.sessionDays,
  });
  return { ...createHttpApp(services, { storage, config, setup, logger }), services };
}

export function createApp(options: TestAppOptions): Express {
  return composeApp(options).app;
}
