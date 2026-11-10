import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { InstanceSettings } from '../../domain/model.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { utcInstant } from '../conversion.ts';
import { createRateLimitRepository } from './rate-limits.ts';
import { createSessionRepository, createTokenRepository } from './account-tokens.ts';
import { settingKeys, type AccountRepositories } from './account-rows.ts';
import { createUserRepository } from './users.ts';
import { createWorkspaceRepository } from './workspaces.ts';

export type { AccountRepositories } from './account-rows.ts';

export function createAccountRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): AccountRepositories {
  const workspaces = createWorkspaceRepository(db, backend);
  return {
    users: createUserRepository(db, backend, workspaces),
    workspaces,
    rateLimits: createRateLimitRepository(db, backend),
    settings: {
      async read() {
        const values: Partial<InstanceSettings> = {};
        for (const row of await db.selectFrom('instance_settings').select(['key', 'value']).execute()) {
          const key = (Object.keys(settingKeys) as Array<keyof InstanceSettings>).find(k => settingKeys[k] === row.key);
          if (key) {
            try {
              const value: unknown = JSON.parse(row.value);
              if (typeof value === 'number' || typeof value === 'boolean') Object.assign(values, { [key]: value });
            } catch {
              /* Domain applies defaults. */
            }
          }
        }
        return values;
      },
      async write(changes) {
        for (const change of changes) {
          const values = {
            key: settingKeys[change.key],
            value: JSON.stringify(change.value),
            updated_at: utcInstant(change.updatedAt),
            updated_by: change.updatedBy,
          };
          const query = db.insertInto('instance_settings').values(values);
          if (backend === 'mysql' || backend === 'mariadb') await query.onDuplicateKeyUpdate(values).execute();
          else await query.onConflict(oc => oc.column('key').doUpdateSet(values)).execute();
        }
      },
    },
    tokens: createTokenRepository(db, backend),
    sessions: createSessionRepository(db, backend),
  };
}
