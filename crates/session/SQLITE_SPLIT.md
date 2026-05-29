# SQLite Split Strategy

## Current State

Single SQLite database managed by Drizzle ORM (TS):
- `packages/opencode/src/storage/` — Effect-based DB layer
- Tables: sessions, parts, projects, workspaces, config, snapshots, etc.

## Phase 0-3: Dual Database

```
state.db (TS-owned, Drizzle ORM)
├── projects
├── workspaces
├── config
└── snapshots

runtime.db (Rust-owned, rusqlite)
├── sessions
├── parts (messages)
└── tool_results
```

### Migration Plan

1. Create `runtime.db` with session/parts schema (Rust)
2. Modify TS `Database` layer to route session writes to sidecar RPC
3. Keep TS reading from state.db for project/config data
4. Feature flag `OPENCODE_RUST_SESSION_DB` controls routing

### Schema (runtime.db)

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    project_id TEXT NOT NULL,
    workspace_id TEXT,
    directory TEXT NOT NULL,
    path TEXT,
    parent_id TEXT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- summary fields
    summary_additions INTEGER,
    summary_deletions INTEGER,
    summary_files INTEGER,
    summary_diffs TEXT,
    -- share
    share_url TEXT,
    revert TEXT
);

CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    seq INTEGER NOT NULL
);

CREATE INDEX idx_parts_session ON parts(session_id, seq);
CREATE INDEX idx_sessions_project ON sessions(project_id);
```

## Phase 4: Unified Database

After Session+Agent migration completes:
1. Migrate state.db tables into runtime.db → rename to opencode.db
2. TS accesses all data via sidecar RPC
3. Delete state.db
4. Single writer (Rust) eliminates all lock contention

### Migration Script (Phase 4)

```sql
-- Attach old database
ATTACH DATABASE 'state.db' AS old;

-- Copy tables
INSERT INTO projects SELECT * FROM old.projects;
INSERT INTO config SELECT * FROM old.config;
-- ...

DETACH DATABASE old;
```
