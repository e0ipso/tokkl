import { openConnection } from '../../../src/storage/connections.ts';
import { initializeDatabase, migrate, migrations } from '../../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';
import type { StorageConfig } from '../../../src/storage/config.ts';
const config = JSON.parse(process.env.TOKKL_TEST_CONFIG!) as StorageConfig;
const mode = process.env.TOKKL_TEST_MODE!;
try {
  if (mode === 'interrupt') {
    const connection = await openConnection<PhysicalDatabase>(config);
    await migrate(connection, [...migrations(config.backend), { version: migrations(config.backend).at(-1)!.version + 1, name: 'interruption_probe', statements: ['CREATE TABLE interruption_probe (value INTEGER)'] }], async () => {
      process.send?.('ddl-applied');
      await new Promise<void>(resolve => process.once('message', () => resolve()));
    });
  } else {
    process.send?.('ready');
    await new Promise<void>(resolve => process.once('message', () => resolve()));
    const direct = mode.includes('baseline') || mode === 'held';
    const connection = direct ? await openConnection<PhysicalDatabase>(config) : await initializeDatabase(config);
    let held = false;
    if (direct) await migrate(connection, mode.includes('baseline') ? migrations(config.backend).slice(0, 1) : migrations(config.backend), async () => {
      if (held || !mode.startsWith('held')) return;
      held = true;
      process.send?.('ddl-applied');
      await new Promise<void>(resolve => process.once('message', () => resolve()));
    });
    await connection.close();
    process.send?.('complete');
  }
  process.disconnect();
} catch (error) { process.send?.({ error: String(error) }); process.exitCode = 1; process.disconnect(); }
