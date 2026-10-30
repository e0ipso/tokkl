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
  // Project and task totals sum live entries per project or task. These partial indexes cover
  // those sums so they read one project's or task's rows instead of scanning the whole history.
  // deleted_at is always NULL in them; listing it lets SQLite answer the sums from the index alone.
  `
  CREATE INDEX time_entries_project_live ON time_entries(project_id, start, stop, deleted_at)
    WHERE deleted_at IS NULL AND project_id IS NOT NULL;
  CREATE INDEX time_entries_task_live ON time_entries(task_id, start, stop, deleted_at)
    WHERE deleted_at IS NULL AND task_id IS NOT NULL;
  `,
  // Instance roles, suspended accounts and workspace membership. Before this, setup allowed a
  // single account, so the backfill makes every existing user an admin and gives every existing
  // workspace, including ones created without an owner, to the lowest-id user. A fresh database
  // has no users or workspaces yet, so the backfill touches no rows.
  `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));
  ALTER TABLE users ADD COLUMN disabled_at TEXT;

  CREATE TABLE workspace_users (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX workspace_users_user ON workspace_users(user_id);

  UPDATE users SET role = 'admin';
  INSERT INTO workspace_users (workspace_id, user_id, role)
    SELECT workspaces.id, owner.id, 'owner'
    FROM workspaces, (SELECT MIN(id) AS id FROM users) AS owner
    WHERE owner.id IS NOT NULL;
  `,
  // Instance settings an admin can change at runtime. Each value is JSON. A key with no row uses its
  // default (models/settings.ts). Deleting the admin who last changed a setting keeps the setting.
  `
  CREATE TABLE instance_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // One-time links: invites now, password resets later. Only the SHA-256 of the token is stored.
  // user_id is the account a used invite created, or the account a reset is for. created_by is set
  // to NULL when its admin is deleted, so the used invites they created stay as a record.
  `
  CREATE TABLE account_tokens (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('invite', 'password_reset')),
    role TEXT CHECK (role IN ('admin', 'user')),
    note TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX account_tokens_user ON account_tokens(user_id);
  CREATE INDEX account_tokens_created_by ON account_tokens(created_by);
  `,
  // Rewrites stored timezones to their canonical name, as writes now store them. canonical_time_zone
  // is registered in db/index.ts and follows the ICU of the Node running the migration. Names it
  // rejects, such as offset IDs and unknown zones, stay as they are rather than becoming UTC.
  // updated_at is left alone: the account did not change, only the spelling of its zone.
  `
  UPDATE users SET timezone = canonical_time_zone(timezone)
    WHERE canonical_time_zone(timezone) IS NOT NULL AND canonical_time_zone(timezone) <> timezone;
  `,
  // The session model uses only the four length preferences.
  `
  UPDATE users SET preferences = json_remove(
    preferences, '$.pomodoro_enabled', '$.pomodoro_stop_timer_at_end'
  );
  `,
  // Timer state the server keeps for each user, so every device sees the same one
  // (models/timerState.ts). A Pomodoro session's open pomodoro is the user's running entry,
  // entry_id; the four lengths are the ones the session started with. A pause chain holds the
  // fields its resumed clone copies and the seconds stored so far; clone_entry_id is set while a
  // clone runs. Neither entry id has a foreign key: a purge removes the entry, and settlement must
  // see that it is gone. A chain loses a deleted project or task, as entries do. timer_states holds
  // the revision, the fingerprint of the state it numbers, and the pomodoro that the change which
  // produced the revision sent to the trash for rounding to zero.
  `
  CREATE TABLE pomodoro_sessions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL,
    work_minutes INTEGER NOT NULL,
    short_rest_minutes INTEGER NOT NULL,
    long_rest_minutes INTEGER NOT NULL,
    long_rest_every INTEGER NOT NULL,
    phase_kind TEXT NOT NULL CHECK (phase_kind IN ('work', 'shortRest', 'longRest')),
    phase_start TEXT NOT NULL,
    completed INTEGER NOT NULL
  );

  CREATE TABLE pause_chains (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    tag_ids_json TEXT NOT NULL,
    billable INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    clone_entry_id INTEGER
  );

  CREATE TABLE timer_states (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    discarded_entry_id INTEGER,
    discarded_start TEXT,
    discarded_stop TEXT
  );
  `,
  // Marks a no-time entry: start is local midnight of its day in the owner's timezone and stop is
  // start plus the duration. Existing entries are timed.
  `
  ALTER TABLE time_entries ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0;
  `,
];
