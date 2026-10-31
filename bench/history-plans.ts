import type { Backend } from '../packages/api/src/storage/config.ts';

interface Access {
  table: string;
  access: string;
  index?: string;
  bounded: boolean;
  rows?: number;
  cost?: number;
  predicate?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return undefined; }
}

/** Interpret chosen native access nodes. Candidate index names are deliberately ignored. */
export function classifyHistoryPlan(backend: Backend, plan: unknown, expectedIndex: string, catalogRows: Record<string, number>) {
  const selected: Access[] = [];
  function walk(value: unknown, parentTable = ''): void {
    if (Array.isArray(value)) { for (const node of value) walk(node, parentTable); return; }
    const node = object(value);
    if (!node) return;
    let table = parentTable;
    if (backend === 'sqlite' && typeof node.detail === 'string') {
      const match = /^(SEARCH|SCAN) (\w+)(?: USING (?:COVERING )?(?:INDEX (\w+)|INTEGER PRIMARY KEY))?/i.exec(node.detail);
      if (match) selected.push({ table: match[2]!, access: match[1]!.toUpperCase(),
        index: match[3] ?? (node.detail.includes('INTEGER PRIMARY KEY') ? 'PRIMARY' : undefined),
        bounded: match[1]!.toUpperCase() === 'SEARCH' });
    } else if (backend === 'postgres' && typeof node['Node Type'] === 'string') {
      table = typeof node['Relation Name'] === 'string' ? node['Relation Name'] : table;
      const access = node['Node Type'];
      if (/Scan$/.test(access)) {
        const bitmap = access === 'Bitmap Heap Scan' && Array.isArray(node.Plans) && node.Plans.length > 0
          && node.Plans.every(child => object(child)?.['Node Type'] === 'Bitmap Index Scan' && typeof object(child)?.['Index Cond'] === 'string');
        selected.push({ table, access, bounded: bitmap || (/^(Index Scan|Index Only Scan|Bitmap Index Scan)$/.test(access) && typeof node['Index Cond'] === 'string'),
          ...(typeof node['Index Name'] === 'string' ? { index: node['Index Name'] } : {}),
          ...(typeof node['Plan Rows'] === 'number' ? { rows: node['Plan Rows'] } : {}),
          ...(typeof node['Total Cost'] === 'number' ? { cost: node['Total Cost'] } : {}),
          ...(typeof node.Filter === 'string' ? { predicate: node.Filter } : {}) });
      }
    } else if ((backend === 'mysql' || backend === 'mariadb') && typeof node.table_name === 'string') {
      selected.push({ table: node.table_name, access: String(node.access_type),
        bounded: /^(const|eq_ref|ref|range)$/.test(String(node.access_type)) && typeof node.key === 'string',
        ...(typeof node.key === 'string' ? { index: node.key } : {}),
        ...(typeof (node.rows_examined_per_scan ?? node.rows) === 'number' ? { rows: Number(node.rows_examined_per_scan ?? node.rows) } : {}) });
    }
    for (const [key, child] of Object.entries(node)) {
      // Drivers wrap PostgreSQL and MySQL JSON differently, sometimes as encoded text.
      if (key === 'QUERY PLAN' || key === 'EXPLAIN') walk(decode(child), table);
      else if (typeof child === 'object') walk(child, table);
    }
  }
  walk(plan);
  const history = selected.filter(p => p.table === 'te' || p.table === 'time_entries');
  const fullScans = history.filter(p => !p.bounded);
  const references = selected.filter(p => p.table === 'projects' || p.table === 'tasks');
  const indexed = expectedIndex === 'primary'
    ? references.some(p => p.bounded && /^(PRIMARY|(?:projects|tasks)_pkey|(?:projects|tasks)_workspace(?:_id_id)?)$/i.test(p.index ?? ''))
    : history.some(p => p.bounded && p.index === expectedIndex);
  const ref = references[0];
  // This exception describes the fixed tiny catalogs, not arbitrary selective scans over large tables.
  const boundedCatalog = backend === 'postgres' && expectedIndex === 'primary' && selected.length === 1 && ref !== undefined
    && ref.access === 'Seq Scan' && Number.isInteger(catalogRows[ref.table]) && catalogRows[ref.table]! > 0 && catalogRows[ref.table]! <= 30
    && ref.rows !== undefined && ref.rows >= 0 && ref.rows <= 1
    && ref.cost !== undefined && ref.cost >= 0 && ref.cost <= 2
    && !/\bOR\b/i.test(ref.predicate ?? '')
    && ['workspace_id', 'id'].every(column => new RegExp(`\\b${column}\\s*=\\s*(?:'\\d+'|\\d+)`).test(ref.predicate ?? ''));
  const accepted = selected.length > 0 && fullScans.length === 0
    && (expectedIndex === 'primary' ? history.length === 0 && (indexed || boundedCatalog) : indexed);
  return { indexed, accepted, classification: accepted ? (indexed ? 'indexed' : 'bounded_catalog_reference') : 'rejected',
    selected_accesses: selected, history_full_scans: fullScans };
}
