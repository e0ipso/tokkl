/**
 * Schema migrations, applied in order. Never edit a shipped migration; append a new one.
 * Timestamps are ISO 8601 UTC strings ("2026-10-14T09:00:00.000Z") so they sort as text.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    fullname TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    api_token TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    beginning_of_week INTEGER NOT NULL DEFAULT 1,
    default_workspace_id INTEGER,
    preferences TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    default_currency TEXT NOT NULL DEFAULT 'EUR',
    default_hourly_rate REAL,
    rounding INTEGER NOT NULL DEFAULT 0,
    rounding_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX clients_name ON clients(workspace_id, name COLLATE NOCASE);

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    is_private INTEGER NOT NULL DEFAULT 1,
    billable INTEGER NOT NULL DEFAULT 0,
    estimated_hours REAL,
    rate REAL,
    currency TEXT,
    fixed_fee REAL,
    start_date TEXT,
    end_date TEXT,
    template INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX projects_name ON projects(workspace_id, IFNULL(client_id, 0), name COLLATE NOCASE);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    estimated_seconds INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX tasks_name ON tasks(project_id, name COLLATE NOCASE);

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX tags_name ON tags(workspace_id, name COLLATE NOCASE);

  CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL,
    stop TEXT,
    billable INTEGER NOT NULL DEFAULT 0,
    duronly INTEGER NOT NULL DEFAULT 0,
    created_with TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX time_entries_start ON time_entries(user_id, start);
  CREATE INDEX time_entries_updated ON time_entries(user_id, updated_at);
  -- At most one running entry per user.
  CREATE UNIQUE INDEX time_entries_running ON time_entries(user_id)
    WHERE stop IS NULL AND deleted_at IS NULL;

  CREATE TABLE time_entry_tags (
    time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (time_entry_id, tag_id)
  );
  CREATE INDEX time_entry_tags_tag ON time_entry_tags(tag_id);
  `,
];
