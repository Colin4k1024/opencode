//! Session state machine and persistence
//!
//! Phase 4: Session CRUD, message append, compaction, SQLite storage

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("session not found: {0}")]
    NotFound(String),
}

/// Generate a simple unique ID: hex timestamp + pseudo-random suffix
fn new_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // Mix in address of a stack variable as entropy
    let stack_addr = {
        let x: u64 = 0;
        &x as *const u64 as u128
    };
    format!("{:016x}{:016x}", ts, ts ^ stack_addr ^ (ts >> 17))
}

fn now_iso() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // RFC 3339-ish: just seconds-since-epoch rendered as string for simplicity
    format!("{}", ts)
}

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

/// Open (or create) a SQLite database and initialise the schema.
pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;

         CREATE TABLE IF NOT EXISTS sessions (
             id         TEXT PRIMARY KEY,
             slug       TEXT NOT NULL,
             project_id TEXT NOT NULL,
             directory  TEXT NOT NULL,
             title      TEXT NOT NULL DEFAULT '',
             parent_id  TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_sessions_project
             ON sessions(project_id);

         CREATE TABLE IF NOT EXISTS parts (
             id         TEXT PRIMARY KEY,
             session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
             role       TEXT NOT NULL,
             content    TEXT NOT NULL,
             metadata   TEXT,
             seq        INTEGER NOT NULL,
             created_at TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_parts_session_seq
             ON parts(session_id, seq);
        ",
    )?;
    Ok(conn)
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub id: String,
    pub slug: String,
    pub project_id: String,
    pub directory: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Part {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<String>,
    pub seq: i64,
    pub created_at: String,
}

// ──────────────────────────────────────────────
// Session CRUD
// ──────────────────────────────────────────────

pub struct CreateSessionParams {
    pub slug: String,
    pub project_id: String,
    pub directory: String,
    pub title: String,
    pub parent_id: Option<String>,
}

pub fn create_session(conn: &Connection, params: CreateSessionParams) -> Result<Session> {
    let session = Session {
        id: new_id(),
        slug: params.slug,
        project_id: params.project_id,
        directory: params.directory,
        title: params.title,
        parent_id: params.parent_id,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    conn.execute(
        "INSERT INTO sessions (id, slug, project_id, directory, title, parent_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &session.id,
            &session.slug,
            &session.project_id,
            &session.directory,
            &session.title,
            &session.parent_id,
            &session.created_at,
            &session.updated_at,
        ],
    )?;
    Ok(session)
}

pub fn get_session(conn: &Connection, id: &str) -> Result<Option<Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, project_id, directory, title, parent_id, created_at, updated_at
         FROM sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Session {
            id: row.get(0)?,
            slug: row.get(1)?,
            project_id: row.get(2)?,
            directory: row.get(3)?,
            title: row.get(4)?,
            parent_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn list_sessions(conn: &Connection, project_id: &str) -> Result<Vec<Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, project_id, directory, title, parent_id, created_at, updated_at
         FROM sessions WHERE project_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Session {
            id: row.get(0)?,
            slug: row.get(1)?,
            project_id: row.get(2)?,
            directory: row.get(3)?,
            title: row.get(4)?,
            parent_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn update_title(conn: &Connection, id: &str, title: &str) -> Result<()> {
    let updated_at = now_iso();
    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, updated_at, id],
    )?;
    Ok(())
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(())
}

// ──────────────────────────────────────────────
// Message (Part) operations
// ──────────────────────────────────────────────

fn next_seq(conn: &Connection, session_id: &str) -> Result<i64> {
    let seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), -1) + 1 FROM parts WHERE session_id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    Ok(seq)
}

pub fn append_message(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
    metadata: Option<&str>,
) -> Result<Part> {
    let seq = next_seq(conn, session_id)?;
    let part = Part {
        id: new_id(),
        session_id: session_id.to_owned(),
        role: role.to_owned(),
        content: content.to_owned(),
        metadata: metadata.map(str::to_owned),
        seq,
        created_at: now_iso(),
    };
    conn.execute(
        "INSERT INTO parts (id, session_id, role, content, metadata, seq, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &part.id,
            &part.session_id,
            &part.role,
            &part.content,
            &part.metadata,
            part.seq,
            &part.created_at,
        ],
    )?;
    Ok(part)
}

pub fn get_messages(conn: &Connection, session_id: &str) -> Result<Vec<Part>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, metadata, seq, created_at
         FROM parts WHERE session_id = ?1 ORDER BY seq ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(Part {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            metadata: row.get(4)?,
            seq: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn get_messages_paginated(
    conn: &Connection,
    session_id: &str,
    offset: i64,
    limit: i64,
) -> Result<Vec<Part>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, metadata, seq, created_at
         FROM parts WHERE session_id = ?1 ORDER BY seq ASC LIMIT ?2 OFFSET ?3",
    )?;
    let rows = stmt.query_map(params![session_id, limit, offset], |row| {
        Ok(Part {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            metadata: row.get(4)?,
            seq: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

// ──────────────────────────────────────────────
// Compaction
// ──────────────────────────────────────────────

/// Delete all existing parts for a session and insert a single summary part.
pub fn compact(conn: &Connection, session_id: &str, summary: &str) -> Result<Part> {
    conn.execute(
        "DELETE FROM parts WHERE session_id = ?1",
        params![session_id],
    )?;
    append_message(conn, session_id, "system", summary, Some("{\"compacted\":true}"))
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn open_mem() -> Connection {
        init_db(":memory:").expect("init_db failed")
    }

    fn make_session(conn: &Connection, project_id: &str) -> Session {
        create_session(
            conn,
            CreateSessionParams {
                slug: "test-session".into(),
                project_id: project_id.into(),
                directory: "/tmp".into(),
                title: "Test".into(),
                parent_id: None,
            },
        )
        .expect("create_session failed")
    }

    #[test]
    fn test_create_and_get_session() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-1");
        let fetched = get_session(&conn, &s.id).expect("get_session failed");
        assert_eq!(fetched, Some(s));
    }

    #[test]
    fn test_list_sessions() {
        let conn = open_mem();
        make_session(&conn, "proj-2");
        make_session(&conn, "proj-2");
        make_session(&conn, "proj-other");
        let sessions = list_sessions(&conn, "proj-2").expect("list_sessions failed");
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_update_title() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-3");
        update_title(&conn, &s.id, "New Title").expect("update_title failed");
        let fetched = get_session(&conn, &s.id).unwrap().unwrap();
        assert_eq!(fetched.title, "New Title");
    }

    #[test]
    fn test_append_and_get_messages() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-4");
        let p1 = append_message(&conn, &s.id, "user", "Hello", None).unwrap();
        let p2 = append_message(&conn, &s.id, "assistant", "Hi there", None).unwrap();
        let msgs = get_messages(&conn, &s.id).unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].id, p1.id);
        assert_eq!(msgs[1].id, p2.id);
        assert_eq!(msgs[0].seq, 0);
        assert_eq!(msgs[1].seq, 1);
    }

    #[test]
    fn test_compaction() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-5");
        append_message(&conn, &s.id, "user", "msg1", None).unwrap();
        append_message(&conn, &s.id, "assistant", "msg2", None).unwrap();
        append_message(&conn, &s.id, "user", "msg3", None).unwrap();
        compact(&conn, &s.id, "Summary of conversation").unwrap();
        let msgs = get_messages(&conn, &s.id).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "Summary of conversation");
        assert_eq!(msgs[0].role, "system");
    }

    #[test]
    fn test_delete_session() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-6");
        delete_session(&conn, &s.id).unwrap();
        assert_eq!(get_session(&conn, &s.id).unwrap(), None);
    }

    #[test]
    fn test_paginated_messages() {
        let conn = open_mem();
        let s = make_session(&conn, "proj-7");
        for i in 0..5 {
            append_message(&conn, &s.id, "user", &format!("msg {i}"), None).unwrap();
        }
        let page = get_messages_paginated(&conn, &s.id, 2, 2).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].content, "msg 2");
        assert_eq!(page[1].content, "msg 3");
    }
}
