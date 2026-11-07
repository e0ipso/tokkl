import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../contracts.ts';
import { createClientRepository } from './clients.ts';
import { createProjectRepository } from './projects.ts';
import { createTaskRepository } from './tasks.ts';
import { createTagRepository } from './tags.ts';

/** Construct only with the transaction runner's bound handle. No connection or pool is captured. */
export function createCatalogRepositories(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
): Pick<Repositories, 'clients' | 'projects' | 'tasks' | 'tags'> {
  // Clients and projects check each other; the client lookup is bound once both exist.
  const projects = createProjectRepository(db, backend, { get: (wid, id) => clients.get(wid, id) });
  const clients = createClientRepository(db, backend, projects);
  return {
    clients,
    projects,
    tasks: createTaskRepository(db, backend, projects),
    tags: createTagRepository(db, backend),
  };
}
