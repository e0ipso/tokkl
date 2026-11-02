import type { Kysely } from 'kysely';
import type { SetupCodesRepository } from '../contracts.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { utcInstant } from '../conversion.ts';

/** The only key value the table accepts. */
const PURPOSE = 'first_admin';

/** The schema refuses a second row and any value that is not a lowercase hex SHA-256 hash. */
export function createSetupCodeRepository(db: Kysely<PhysicalDatabase>): SetupCodesRepository {
  return {
    async read() {
      return (await db.selectFrom('setup_codes').select('code_hash').where('purpose', '=', PURPOSE).executeTakeFirst())?.code_hash;
    },
    // Delete then insert is portable. Writers hold the instance administration lock, so two
    // replacements never race for the empty slot.
    async replace(codeHash, at) {
      await db.deleteFrom('setup_codes').where('purpose', '=', PURPOSE).execute();
      await db.insertInto('setup_codes').values({ purpose: PURPOSE, code_hash: codeHash, created_at: utcInstant(at) }).execute();
    },
    async delete() {
      await db.deleteFrom('setup_codes').where('purpose', '=', PURPOSE).execute();
    },
  };
}
