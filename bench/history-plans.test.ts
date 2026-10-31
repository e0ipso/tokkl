import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Backend } from '../packages/api/src/storage/config.ts';
import { classifyHistoryPlan } from './history-plans.ts';

const captured = JSON.parse(readFileSync(new URL('./fixtures/history-plans.json', import.meta.url), 'utf8')) as Array<{
  backend: Backend; fixture: string; name: string; expected_index: string; plan: unknown; catalog_rows: Record<string, number>;
}>;

test('captured PostgreSQL scoped references accept bounded catalog scans without claiming index use', () => {
  const references = captured.filter(p => p.backend === 'postgres' && p.expected_index === 'primary');
  assert.equal(references.length, 4);
  for (const p of references) {
    const result = classifyHistoryPlan(p.backend, p.plan, p.expected_index, p.catalog_rows);
    assert.equal(result.indexed, false);
    assert.equal(result.accepted, true, `${p.fixture} ${p.name}`);
    assert.equal(result.classification, 'bounded_catalog_reference');
  }
});

test('all captured native totals and SQLite/MySQL/MariaDB references retain chosen index acceptance', () => {
  for (const p of captured.filter(p => p.backend !== 'postgres' || p.expected_index !== 'primary')) {
    const result = classifyHistoryPlan(p.backend, p.plan, p.expected_index, p.catalog_rows);
    assert.equal(result.indexed, true, `${p.backend} ${p.fixture} ${p.name}`);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.history_full_scans, []);
  }
});

test('PostgreSQL catalog allowance rejects expanded, unknown, costly and unscoped scans', () => {
  const p = captured.find(p => p.backend === 'postgres' && p.expected_index === 'primary')!;
  const catalogCases: Array<Record<string, number>> = [{ projects: 31 }, { projects: 30000 }, {}, { projects: NaN }];
  for (const counts of catalogCases) {
    assert.equal(classifyHistoryPlan('postgres', p.plan, 'primary', counts).accepted, false);
  }
  for (const change of [
    { 'Plan Rows': 2 }, { 'Total Cost': 3 }, { 'Total Cost': undefined },
    { Filter: '(workspace_id = 1)' }, { Filter: '(id = 1)' },
    { Filter: '(workspace_id = 1 AND id = 1 OR active)' }, { 'Relation Name': 'time_entries' },
  ]) {
    const native = { 'Node Type': 'Seq Scan', 'Relation Name': 'projects', 'Plan Rows': 1, 'Total Cost': 1.45, Filter: '(workspace_id = 1 AND id = 1)', ...change };
    assert.equal(classifyHistoryPlan('postgres', [{ 'QUERY PLAN': [{ Plan: native }] }], 'primary', p.catalog_rows).accepted, false);
  }
});

test('candidate indexes, full index scans and extra history scans never satisfy totals', () => {
  for (const backend of ['mysql', 'mariadb'] as const) {
    const plan = [{ EXPLAIN: JSON.stringify({ query_block: { table: { table_name: 'te', access_type: 'ALL', possible_keys: ['time_entries_project_live'] } } }) }];
    assert.equal(classifyHistoryPlan(backend, plan, 'time_entries_project_live', {}).indexed, false);
    assert.equal(classifyHistoryPlan(backend, plan, 'time_entries_project_live', {}).accepted, false);
  }
  const sqlite = [{ detail: 'SCAN te USING COVERING INDEX time_entries_project_live' }];
  assert.equal(classifyHistoryPlan('sqlite', sqlite, 'time_entries_project_live', {}).accepted, false);
  const valid = { 'Node Type': 'Index Only Scan', 'Relation Name': 'time_entries', 'Index Name': 'time_entries_project_live', 'Index Cond': '(project_id = p.id)' };
  const pg = (Plans: unknown[]) => [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Append', Plans } }] }];
  for (const Plans of [[{ ...valid, 'Index Cond': undefined }], [valid, { 'Node Type': 'Seq Scan', 'Relation Name': 'time_entries' }]]) {
    const result = classifyHistoryPlan('postgres', pg(Plans), 'time_entries_project_live', {});
    assert.equal(result.accepted, false);
    assert.equal(result.history_full_scans.length, 1);
  }
  for (const plan of [[], [{ EXPLAIN: 'not json' }], [{ possible_keys: ['time_entries_project_live'] }]]) {
    assert.equal(classifyHistoryPlan('mysql', plan, 'time_entries_project_live', {}).accepted, false);
  }
});
