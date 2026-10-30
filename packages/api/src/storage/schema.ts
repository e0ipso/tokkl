import type { Backend } from './config.ts';

// This is the logical baseline. Once released, append migrations rather than editing it.
export interface Column {
  type: 'id' | 'integer' | 'real' | 'text' | 'name' | 'key' | 'instant';
  nullable?: boolean;
  default?: string;
  primary?: boolean;
  references?: readonly [string, 'CASCADE' | 'SET NULL'];
  choices?: readonly string[];
}
const id: Column = { type: 'id', primary: true };
const text: Column = { type: 'text' };
const integer: Column = { type: 'integer' };
const instant: Column = { type: 'instant' };
const name: Column = { type: 'name' };
const key: Column = { type: 'key' };
const optional = (column: Column): Column => ({ ...column, nullable: true });
const def = (column: Column, value: string): Column => ({ ...column, default: value });
const choice = (...values: string[]): Column => ({ ...name, choices: values });
const ref = (table: string, action: 'CASCADE' | 'SET NULL' = 'CASCADE', nullable = false): Column => ({ ...integer, references: [table, action], nullable });
const times = { created_at: instant, updated_at: instant };
export const baselineTables: Record<string, Record<string, Column>> = {
  users: {
    id,
    email: name,
    fullname: def(text, "''"),
    password_hash: text,
    api_token: key,
    timezone: def(name, "'UTC'"),
    beginning_of_week: def(integer, '1'),
    default_workspace_id: optional(integer),
    preferences: def(text, "'{}'"),
    ...times,
    role: def(choice('admin', 'user'), "'user'"),
    disabled_at: optional(instant),
  },
  workspaces: {
    id,
    name: text,
    default_currency: def(name, "'EUR'"),
    default_hourly_rate: optional({ type: 'real' }),
    rounding: def(integer, '0'),
    rounding_minutes: def(integer, '0'),
    ...times,
  },
  sessions: {
    token_hash: { ...key, primary: true },
    user_id: ref('users'),
    created_at: instant,
    expires_at: instant,
    user_agent: def(text, "''"),
  },
  clients: {
    id,
    workspace_id: ref('workspaces'),
    name,
    notes: optional(text),
    archived: def(integer, '0'),
    ...times,
  },
  projects: {
    id,
    workspace_id: ref('workspaces'),
    client_id: ref('clients', 'SET NULL', true),
    name,
    color: name,
    active: def(integer, '1'),
    is_private: def(integer, '1'),
    billable: def(integer, '0'),
    estimated_hours: optional({ type: 'real' }),
    rate: optional({ type: 'real' }),
    currency: optional(name),
    fixed_fee: optional({ type: 'real' }),
    start_date: optional(name),
    end_date: optional(name),
    template: def(integer, '0'),
    ...times,
  },
  tasks: {
    id,
    workspace_id: ref('workspaces'),
    project_id: ref('projects'),
    name,
    active: def(integer, '1'),
    estimated_seconds: optional(integer),
    ...times,
  },
  tags: {
    id,
    workspace_id: ref('workspaces'),
    name,
    ...times,
  },
  time_entries: {
    id,
    workspace_id: ref('workspaces'),
    user_id: ref('users'),
    project_id: ref('projects', 'SET NULL', true),
    task_id: ref('tasks', 'SET NULL', true),
    description: def(text, "''"),
    start: instant,
    stop: optional(instant),
    billable: def(integer, '0'),
    duronly: def(integer, '0'),
    created_with: def(text, "''"),
    ...times,
    deleted_at: optional(instant),
    all_day: def(integer, '0'),
  },
  time_entry_tags: {
    time_entry_id: ref('time_entries'),
    tag_id: ref('tags'),
  },
  workspace_users: {
    workspace_id: ref('workspaces'),
    user_id: ref('users'),
    role: choice('owner', 'member'),
  },
  instance_settings: {
    key: { ...key, primary: true },
    value: text,
    updated_at: instant,
    updated_by: ref('users', 'SET NULL', true),
  },
  account_tokens: {
    id,
    token_hash: key,
    kind: choice('invite', 'password_reset'),
    role: optional(choice('admin', 'user')),
    note: optional(text),
    user_id: ref('users', 'CASCADE', true),
    created_by: ref('users', 'SET NULL', true),
    created_at: instant,
    expires_at: instant,
    used_at: optional(instant),
  },
  pomodoro_sessions: {
    user_id: { ...ref('users'), primary: true },
    entry_id: integer,
    work_minutes: integer,
    short_rest_minutes: integer,
    long_rest_minutes: integer,
    long_rest_every: integer,
    phase_kind: choice('work', 'shortRest', 'longRest'),
    phase_start: instant,
    completed: integer,
  },
  pause_chains: {
    user_id: { ...ref('users'), primary: true },
    workspace_id: ref('workspaces'),
    project_id: ref('projects', 'SET NULL', true),
    task_id: ref('tasks', 'SET NULL', true),
    description: text,
    tag_ids_json: text,
    billable: integer,
    seconds: integer,
    clone_entry_id: optional(integer),
  },
  timer_states: {
    user_id: { ...ref('users'), primary: true },
    revision: integer,
    fingerprint: text,
    discarded_entry_id: optional(integer),
    discarded_start: optional(instant),
    discarded_stop: optional(instant),
  },
};
export const ledgerColumns: Record<string, Column> = {
  version: { ...integer, primary: true }, name, checksum: key, state: choice('applying', 'complete'), schema_hash: optional(key),
};
export const serverDDL = (backend: Backend) => backend === 'mysql' || backend === 'mariadb';
export function quote(backend: Backend, value: string): string {
  if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error('Invalid storage identifier');
  return serverDDL(backend) ? `\`${value}\`` : `"${value}"`;
}
function columnDDL(backend: Backend, columnName: string, c: Column): string {
  const q = (v: string) => quote(backend, v);
  let type = c.type === 'real' ? (backend === 'sqlite' ? 'REAL' : 'DOUBLE PRECISION')
    : c.type === 'id' ? (backend === 'sqlite' ? 'INTEGER' : 'BIGINT')
    : c.type === 'integer' ? (backend === 'sqlite' ? 'INTEGER' : 'BIGINT')
    : c.type === 'name' ? (serverDDL(backend) ? 'VARCHAR(255)' : 'TEXT')
    : c.type === 'key' ? (serverDDL(backend) ? 'VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin' : 'TEXT')
    : c.type === 'instant' ? (serverDDL(backend) ? 'VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin' : 'TEXT') : serverDDL(backend) ? 'LONGTEXT' : 'TEXT';
  if (backend === 'postgres' && ['text', 'name', 'key', 'instant'].includes(c.type)) type += ' COLLATE "C"';
  if (c.type === 'id') type += backend === 'postgres' ? ' GENERATED BY DEFAULT AS IDENTITY' : serverDDL(backend) ? ' AUTO_INCREMENT' : '';
  const choiceColumn = serverDDL(backend) ? `CAST(${q(columnName)} AS BINARY)` : q(columnName);
  return `${q(columnName)} ${type}${c.nullable ? '' : ' NOT NULL'}${c.primary ? ' PRIMARY KEY' : ''}${c.default === undefined ? '' : ` DEFAULT ${backend === 'mysql' && c.type === 'text' ? `(${c.default})` : c.default}`}${c.choices ? ` CHECK (${choiceColumn} IN (${c.choices.map(v => `'${v}'`).join(', ')}))` : ''}`;
}
// REPLACE is case-sensitive on all four engines. LOWER would fold non-ASCII on servers.
function asciiFold(expression: string): string {
  for (let code = 65; code <= 90; code++) expression = `replace(${expression}, '${String.fromCharCode(code)}', '${String.fromCharCode(code + 32)}')`;
  return expression;
}
const comparisonColumns: Record<string, string> = { users: 'email', clients: 'name', projects: 'name', tasks: 'name', tags: 'name' };
export function createTableDDL(backend: Backend, table: string, columns: Record<string, Column>): string {
  const q = (v: string) => quote(backend, v);
  const parts = Object.entries(columns).map(([n, c]) => columnDDL(backend, n, c));
  const compared = comparisonColumns[table];
  if (compared) {
    const expression = asciiFold(q(compared));
    // VARBINARY avoids MySQL/MariaDB PAD SPACE collation semantics, including trailing spaces.
    const type = serverDDL(backend) ? 'VARBINARY(1020)' : backend === 'postgres' ? 'TEXT COLLATE "C"' : 'TEXT COLLATE BINARY';
    parts.push(`${q(`${compared}_key`)} ${type} GENERATED ALWAYS AS (${expression}) STORED`);
  }
  if (table === 'projects') parts.push(`${q('client_scope')} ${backend === 'sqlite' ? 'INTEGER' : 'BIGINT'} GENERATED ALWAYS AS (coalesce(${q('client_id')}, 0)) ${serverDDL(backend) ? 'VIRTUAL' : 'STORED'}`);
  if (table === 'time_entries' && serverDDL(backend)) parts.push(`${q('running_user_id')} BIGINT GENERATED ALWAYS AS (CASE WHEN ${q('stop')} IS NULL AND ${q('deleted_at')} IS NULL THEN ${q('user_id')} ELSE NULL END) VIRTUAL`);
  if (table === 'time_entry_tags') parts.push(`PRIMARY KEY (${q('time_entry_id')}, ${q('tag_id')})`);
  if (table === 'workspace_users') parts.push(`PRIMARY KEY (${q('workspace_id')}, ${q('user_id')})`);
  for (const [n, c] of Object.entries(columns)) if (c.references) parts.push(`FOREIGN KEY (${q(n)}) REFERENCES ${q(c.references[0])} (${q('id')}) ON DELETE ${c.references[1]}`);
  return `CREATE TABLE ${q(table)} (${parts.join(', ')})${serverDDL(backend) ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin' : ''}`;
}
export interface SchemaIndex { name: string; table: string; columns: string[]; unique?: boolean; where?: string }
export const baselineIndexes: SchemaIndex[] = [
  { name: 'users_email', table: 'users', columns: ['email_key'], unique: true },
  { name: 'users_api_token', table: 'users', columns: ['api_token'], unique: true },
  { name: 'clients_name', table: 'clients', columns: ['workspace_id', 'name_key'], unique: true },
  { name: 'projects_name', table: 'projects', columns: ['workspace_id', 'client_scope', 'name_key'], unique: true },
  { name: 'tasks_name', table: 'tasks', columns: ['project_id', 'name_key'], unique: true },
  { name: 'tags_name', table: 'tags', columns: ['workspace_id', 'name_key'], unique: true },
  { name: 'account_tokens_hash', table: 'account_tokens', columns: ['token_hash'], unique: true },
  ...Object.entries({ time_entries: ['user_id,start', 'user_id,updated_at'], sessions: ['user_id'], workspace_users: ['user_id'], time_entry_tags: ['tag_id'], account_tokens: ['user_id', 'created_by'], projects: ['workspace_id,id', 'client_id'], tasks: ['workspace_id,id'], pause_chains: ['workspace_id'] }).flatMap(([table, groups]) => groups.map(columns => ({ name: `${table}_${columns.replaceAll(',', '_')}`, table, columns: columns.split(',') }))),
];
export const totalsIndexes: SchemaIndex[] = ['project', 'task'].map(kind => ({ name: `time_entries_${kind}_live`, table: 'time_entries', columns: [`${kind}_id`, 'deleted_at', 'start', 'stop'], where: `deleted_at IS NULL AND ${kind}_id IS NOT NULL` }));
export function indexDDL(backend: Backend, index: SchemaIndex): string {
  const q = (v: string) => quote(backend, v);
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ON ${q(index.table)} (${index.columns.map(q).join(', ')})${index.where && !serverDDL(backend) ? ` WHERE ${index.where}` : ''}`;
}
// InnoDB can visit clients before projects during a workspace cascade. Its SET NULL update
// then rechecks a project's already deleted workspace. Delete projects while that parent exists.
export function baselineDDL(backend: Backend): string[] {
  return [...Object.entries(baselineTables).map(([name, columns]) => createTableDDL(backend, name, columns)), ...(serverDDL(backend) ? [`CREATE TRIGGER workspaces_delete_projects BEFORE DELETE ON ${quote(backend, 'workspaces')} FOR EACH ROW DELETE FROM ${quote(backend, 'projects')} WHERE workspace_id = OLD.id`] : []), ...baselineIndexes.map(index => indexDDL(backend, index)), indexDDL(backend, { name: 'time_entries_running', table: 'time_entries', columns: [serverDDL(backend) ? 'running_user_id' : 'user_id'], unique: true, where: 'stop IS NULL AND deleted_at IS NULL' })];
}
