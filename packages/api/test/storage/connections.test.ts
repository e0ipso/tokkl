import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sql } from 'kysely';
import { parseStorageConfig } from '../../src/storage/config.ts';
import { openConnection, openReadConnection, StorageConnectionError, postgresOptions, mysqlOptions } from '../../src/storage/connections.ts';

test('SQLite factory health/close are async, read-only opening cannot create a database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-storage-'));
  try {
    const config = parseStorageConfig({}, dir);
    const writer = await openConnection(config);
    await writer.health();
    await sql`create table sample (id integer primary key, name text)`.execute(writer.db);
    await sql`insert into sample values (1, 'persisted')`.execute(writer.db);
    const reader = await openReadConnection(config);
    try {
      assert.equal(reader.readOnly, true);
      assert.deepEqual((await sql`select * from sample`.execute(reader.db)).rows.map((r) => ({ ...r as object })), [{ id: 1, name: 'persisted' }]);
      await assert.rejects(sql`insert into sample values (2, 'forbidden')`.execute(reader.db), /readonly/);
      await reader.db.transaction().execute(async (trx) => { await sql`select * from sample`.execute(trx); });
    } finally { await reader.close(); }
    await Promise.all([writer.close(), writer.close()]);
    await assert.rejects(writer.health(), StorageConnectionError);
    const absent = { backend: 'sqlite' as const, filename: join(dir, 'absent', 'never.sqlite'), busyTimeoutMs: 100 };
    await assert.rejects(openReadConnection(absent), StorageConnectionError);
    assert.equal(existsSync(join(dir, 'absent')), false);
    await assert.rejects(openReadConnection({ backend: 'sqlite', filename: ':memory:', busyTimeoutMs: 100 }), StorageConnectionError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const backend of ['postgres', 'mysql', 'mariadb']) {
  test(`${backend} rejects an unreachable explicit server and never falls back to SQLite`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokkl-no-fallback-'));
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    try {
      const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${backend}://dummy:private-password@127.0.0.1:${port}/private-database?sslmode=disable&connect_timeout_ms=100` }, dir);
      await assert.rejects(openConnection(config), (error: unknown) => {
        assert.ok(error instanceof StorageConnectionError);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(JSON.stringify(error) + error.stack, /dummy|private-password|private-database|ECONNREFUSED/);
        return true;
      });
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('driver options preserve numeric/date values and explicitly verify TLS identity', () => {
  const config = parseStorageConfig({ TOKKL_DATABASE_URL: 'postgres://u:p@localhost/db' }, '/tmp');
  assert.ok(config.backend !== 'sqlite');
  const pg = postgresOptions(config, true);
  assert.deepEqual(pg.ssl, { rejectUnauthorized: true });
  assert.equal(pg.max, 1);
  assert.match(pg.options!, /timezone=UTC/);
  assert.match(pg.options!, /default_transaction_read_only=on/);
  const mysql = mysqlOptions({ ...config, backend: 'mariadb' }, true);
  assert.deepEqual(mysql.ssl, { rejectUnauthorized: true, verifyIdentity: true });
  assert.equal(mysql.connectionLimit, 1);
  assert.equal(mysql.waitForConnections, true);
  assert.equal(mysql.supportBigNumbers, true);
  assert.equal(mysql.bigNumberStrings, true);
  assert.equal(mysql.decimalNumbers, false);
  assert.equal(mysql.dateStrings, true);
  assert.equal(mysql.jsonStrings, true);
  assert.equal(mysql.timezone, 'Z');
  assert.equal(mysql.multipleStatements, false);
});

test('explicit empty pg password cannot inherit process credentials', () => {
  const config = parseStorageConfig({ TOKKL_DATABASE_URL: 'postgres://u:@localhost/db' }, '/tmp');
  assert.ok(config.backend !== 'sqlite');
  const options = postgresOptions(config, false);
  assert.equal(typeof options.password, 'function');
  if (typeof options.password === 'function') assert.equal(options.password(), '');
});

for (const backend of ['postgres', 'mysql', 'mariadb']) {
  test(`${backend} bounds a stalled handshake and closes its socket`, { timeout: 5000 }, async () => {
    const sockets = new Set<import('node:net').Socket>();
    const closed: Promise<void>[] = [];
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.resume();
      closed.push(new Promise<void>((resolve) => socket.on('close', () => { sockets.delete(socket); resolve(); })));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${backend}://dummy:private-password@127.0.0.1:${address.port}/private-database?sslmode=disable&connect_timeout_ms=100` }, '/tmp');
      await assert.rejects(openConnection(config), StorageConnectionError);
      await Promise.all(closed);
      assert.equal(sockets.size, 0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

for (const backend of ['postgres', 'mysql', 'mariadb']) {
  test(`${backend} discards server error text that contains credentials`, async () => {
    const secret = 'private-password/private-database';
    const message = `Access denied ${secret}`;
    const server = createServer((socket) => {
      socket.on('error', () => {});
      socket.resume();
      if (backend === 'postgres') {
        socket.once('data', () => {
          const body = Buffer.from(`SERROR\0C28000\0M${message}\0\0`);
          const header = Buffer.alloc(5); header[0] = 69; header.writeInt32BE(body.length + 4, 1);
          socket.end(Buffer.concat([header, body]));
        });
      } else {
        const body = Buffer.concat([Buffer.from([0xff, 0x15, 0x04]), Buffer.from(`#28000${message}`)]);
        const header = Buffer.alloc(4); header.writeUIntLE(body.length, 0, 3);
        socket.end(Buffer.concat([header, body]));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${backend}://dummy:private-password@127.0.0.1:${address.port}/private-database?sslmode=disable&connect_timeout_ms=100` }, '/tmp');
      await assert.rejects(openConnection(config), (error: unknown) => {
        assert.ok(error instanceof StorageConnectionError);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(JSON.stringify(error) + error.stack, /private-password|private-database|Access denied/);
        return true;
      });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
}
