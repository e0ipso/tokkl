/**
 * The catalog operations as a request reaches them: each raw body is parsed by the same command
 * parser the routes use, then handed to the domain. Domain tests keep their bodies.
 */
import * as parse from '../../src/commands/catalogs.ts';
import * as domain from '../../src/domain/catalogs.ts';
import type { CatalogContext, CatalogTimerEffects } from '../../src/domain/catalogs.ts';

export * from '../../src/domain/catalogs.ts';

type Body = Record<string, unknown>;

export const createClient = async (ctx: CatalogContext, wid: number, body: Body) =>
  domain.createClient(ctx, wid, parse.parseNewClient(body));
export const updateClient = async (
  ctx: CatalogContext,
  wid: number,
  id: number,
  body: Body,
  effects: CatalogTimerEffects,
) => domain.updateClient(ctx, wid, id, parse.parseClientChanges(body), effects);
export const restoreClient = async (
  ctx: CatalogContext,
  wid: number,
  id: number,
  body: Body,
  effects: CatalogTimerEffects,
) => domain.restoreClient(ctx, wid, id, parse.parseClientRestore(body), effects);
export const createProject = async (ctx: CatalogContext, wid: number, body: Body) =>
  domain.createProject(ctx, wid, parse.parseNewProject(body));
export const updateProject = async (
  ctx: CatalogContext,
  wid: number,
  id: number,
  body: Body,
  effects: CatalogTimerEffects,
) => domain.updateProject(ctx, wid, id, parse.parseProjectChanges(body), effects);
export const createTask = async (ctx: CatalogContext, wid: number, pid: number, body: Body) =>
  domain.createTask(ctx, wid, pid, parse.parseNewTask(body));
export const updateTask = async (
  ctx: CatalogContext,
  wid: number,
  pid: number,
  id: number,
  body: Body,
  effects: CatalogTimerEffects,
) => domain.updateTask(ctx, wid, pid, id, parse.parseTaskChanges(body), effects);
export const createTag = async (ctx: CatalogContext, wid: number, body: Body) =>
  domain.createTag(ctx, wid, parse.parseTagName(body));
export const updateTag = async (
  ctx: CatalogContext,
  wid: number,
  id: number,
  body: Body,
  effects: CatalogTimerEffects,
) => domain.updateTag(ctx, wid, id, parse.parseTagName(body), effects);
