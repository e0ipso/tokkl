import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import type { TestContext } from './helpers.ts';

interface Observation {
  name: string;
  status: number;
  contentType: string | null;
  disposition: string | null;
  body: unknown;
}

/** IDs may differ by engine, while their JSON number type and nullable relationships may not. */
function normalize(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => normalize(item, key.endsWith('_ids') ? 'id' : ''));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, normalize(item, field)]));
  }
  if (key === 'toggl_accounts_id') {
    assert.equal(typeof value, 'string');
    assert.match(value as string, /^\d+$/);
    return '<string-id>';
  }
  if (key === 'id' || key.endsWith('_id') || ['wid', 'uid', 'pid', 'tid', 'cid'].includes(key)) {
    assert.equal(typeof value, 'number', `${key} must remain a JSON number`);
    assert.ok(Number.isSafeInteger(value) && (value as number) > 0, `${key} must be a positive safe integer`);
    return '<id>';
  }
  if (key === 'api_token') {
    assert.equal(typeof value, 'string');
    assert.ok((value as string).length > 0);
    return '<credential>';
  }
  return value;
}

/** Records HTTP only; fixtures contain no driver rows or database-specific values. */
export function reference(ctx: TestContext) {
  const observations: Observation[] = [];
  const capture = async (name: string, method: string, path: string, body?: unknown,
    options: { status?: number; headers?: Record<string, string>; idArray?: boolean } = {}) => {
    const response = await ctx.request(method, path, body, options.headers);
    const text = await response.text();
    const contentType = response.headers.get('content-type');
    const data: any = text && contentType?.startsWith('application/json') ? JSON.parse(text) : text;
    assert.equal(response.status, options.status ?? 200, `${name}: ${text}`);
    observations.push({ name, status: response.status, contentType,
      disposition: response.headers.get('content-disposition'), body: normalize(data, options.idArray ? 'record_ids' : '') });
    return { status: response.status, body: data, headers: response.headers };
  };
  return {
    capture,
    compare(name: string) {
      const path = new URL(`./fixtures/storage-${name}.json`, import.meta.url);
      if (process.env.TOKKL_CAPTURE_STORAGE_REFERENCE === '1') {
        writeFileSync(path, `${JSON.stringify(observations, null, 2)}\n`);
      }
      assert.deepEqual(observations, JSON.parse(readFileSync(path, 'utf8')),
        `HTTP behavior changed for ${name}; compare against the reviewed SQLite reference`);
    },
  };
}
