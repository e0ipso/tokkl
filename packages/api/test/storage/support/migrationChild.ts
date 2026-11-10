import { openConnection } from '../../../src/storage/connections.ts';
import { runMigrations } from '../../../src/storage/migrationRunner.ts';
import { initializeDatabase, migrations } from '../../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';
import type { StorageConfig } from '../../../src/storage/config.ts';
import { afterStatements } from './statementHook.ts';
const config = JSON.parse(process.env.TOKKL_TEST_CONFIG!) as StorageConfig;
const mode = process.env.TOKKL_TEST_MODE!;
const hold = async () => {
  process.send?.('ddl-applied');
  await new Promise<void>(resolve => process.once('message', () => resolve()));
};
try {
  if (mode === 'interrupt') {
    const probe = {
      version: migrations(config.backend).at(-1)!.version + 1,
      name: 'interruption_probe',
      statements: ['CREATE TABLE interruption_probe (value INTEGER)'],
    };
    const connection = afterStatements(await openConnection<PhysicalDatabase>(config), probe.statements, hold);
    await runMigrations(connection, [...migrations(config.backend), probe]);
  } else {
    process.send?.('ready');
    await new Promise<void>(resolve => process.once('message', () => resolve()));
    const direct = mode.includes('baseline') || mode === 'held';
    const available = mode.includes('baseline') ? migrations(config.backend).slice(0, 1) : migrations(config.backend);
    let held = false;
    const opened = direct ? await openConnection<PhysicalDatabase>(config) : await initializeDatabase(config);
    const connection = mode.startsWith('held')
      ? afterStatements(
          opened,
          available.flatMap(migration => migration.statements),
          async () => {
            if (held) return;
            held = true;
            await hold();
          },
        )
      : opened;
    if (direct) await runMigrations(connection, available);
    await connection.close();
    process.send?.('complete');
  }
  process.disconnect();
} catch (error) {
  process.send?.({ error: String(error) });
  process.exitCode = 1;
  process.disconnect();
}
