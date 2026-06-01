//! Cross-crate integration tests.
//!
//! Exercises `session`, `agent`, and `plugin` subsystems together, verifying
//! that their contracts mesh at the boundaries that matter for the runtime.

use opencode_agent::{AgentInfo, AgentMode, AgentRegistry, ModelConfig, Permission, PermissionRule};
use opencode_plugin::PluginRegistry;
use opencode_session::{
    append_message, compact, create_session, delete_session, get_messages,
    get_messages_paginated, get_session, init_db, list_sessions, update_title,
    CreateSessionParams,
};
use std::io::Write;
use tempfile::TempDir;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn mem_db() -> rusqlite::Connection {
    init_db(":memory:").expect("init_db")
}

fn make_session(conn: &rusqlite::Connection, project_id: &str) -> opencode_session::Session {
    create_session(
        conn,
        CreateSessionParams {
            slug: "cross-crate-session".into(),
            project_id: project_id.into(),
            directory: "/tmp".into(),
            title: "Cross-crate test".into(),
            parent_id: None,
        },
    )
    .expect("create_session")
}

fn make_agent(name: &str, mode: AgentMode) -> AgentInfo {
    AgentInfo {
        name: name.into(),
        description: format!("{name} agent"),
        mode,
        model: ModelConfig::default(),
        temperature: 0.7,
        top_p: 0.9,
        permissions: Permission {
            rules: vec![PermissionRule {
                tool: "*".into(),
                action: "*".into(),
                allow: true,
            }],
        },
        prompt_template: format!("You are {name}."),
    }
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

#[test]
fn test_session_create_and_get() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-alpha");

    let fetched = get_session(&conn, &session.id)
        .expect("get_session")
        .expect("session not found");

    assert_eq!(fetched.id, session.id);
    assert_eq!(fetched.slug, "cross-crate-session");
    assert_eq!(fetched.project_id, "proj-alpha");
}

#[test]
fn test_session_list_filters_by_project() {
    let conn = mem_db();
    make_session(&conn, "proj-x");
    make_session(&conn, "proj-x");
    make_session(&conn, "proj-y");

    let sessions_x = list_sessions(&conn, "proj-x").expect("list_sessions");
    let sessions_y = list_sessions(&conn, "proj-y").expect("list_sessions");

    assert_eq!(sessions_x.len(), 2);
    assert_eq!(sessions_y.len(), 1);
}

#[test]
fn test_session_update_title() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-t");

    update_title(&conn, &session.id, "Updated").expect("update_title");

    let fetched = get_session(&conn, &session.id).unwrap().unwrap();
    assert_eq!(fetched.title, "Updated");
}

#[test]
fn test_session_delete_removes_session_and_parts() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-d");
    append_message(&conn, &session.id, "user", "hello", None).unwrap();

    delete_session(&conn, &session.id).expect("delete_session");

    assert!(get_session(&conn, &session.id).unwrap().is_none());
    let msgs = get_messages(&conn, &session.id).unwrap();
    assert!(msgs.is_empty(), "parts should cascade-delete with session");
}

// ── Message operations ────────────────────────────────────────────────────────

#[test]
fn test_message_append_and_sequential_seqs() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-msg");

    let roles = ["user", "assistant", "user", "assistant"];
    for (i, role) in roles.iter().enumerate() {
        append_message(&conn, &session.id, role, &format!("msg {i}"), None).unwrap();
    }

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs.len(), 4);
    for (i, msg) in msgs.iter().enumerate() {
        assert_eq!(msg.seq, i as i64);
    }
}

#[test]
fn test_message_pagination() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-page");
    for i in 0..10 {
        append_message(&conn, &session.id, "user", &format!("msg {i}"), None).unwrap();
    }

    let page = get_messages_paginated(&conn, &session.id, 3, 4).unwrap();
    assert_eq!(page.len(), 4);
    assert_eq!(page[0].content, "msg 3");
    assert_eq!(page[3].content, "msg 6");
}

#[test]
fn test_message_metadata_roundtrip() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-meta");
    let meta = r#"{"tool":"bash","exit_code":0}"#;
    append_message(&conn, &session.id, "tool", "output", Some(meta)).unwrap();

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs[0].metadata.as_deref(), Some(meta));
}

// ── Compaction ────────────────────────────────────────────────────────────────

#[test]
fn test_compaction_replaces_history_with_summary() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-compact");

    for i in 0..5 {
        append_message(&conn, &session.id, "user", &format!("turn {i}"), None).unwrap();
    }

    compact(&conn, &session.id, "Compacted summary").unwrap();

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].content, "Compacted summary");
    assert_eq!(msgs[0].role, "system");
}

// ── AgentRegistry ─────────────────────────────────────────────────────────────

#[test]
fn test_agent_registry_insert_list_get() {
    let mut reg = AgentRegistry::new();
    reg.insert(make_agent("alpha", AgentMode::Primary));
    reg.insert(make_agent("beta", AgentMode::Subagent));

    assert_eq!(reg.list().len(), 2);
    assert_eq!(reg.get("alpha").unwrap().mode, AgentMode::Primary);
    assert_eq!(reg.get("beta").unwrap().mode, AgentMode::Subagent);
    assert!(reg.get("gamma").is_none());
}

#[test]
fn test_agent_registry_default_agent_is_primary() {
    let mut reg = AgentRegistry::new();
    reg.insert(make_agent("sub1", AgentMode::Subagent));
    reg.insert(make_agent("main", AgentMode::Primary));

    assert_eq!(reg.default_agent().name, "main");
}

#[test]
fn test_agent_permission_wildcard_allow() {
    let agent = make_agent("root", AgentMode::Primary);
    assert!(agent.permissions.allows("bash", "write"));
    assert!(agent.permissions.allows("fs", "read"));
    assert!(agent.permissions.allows("anything", "anything"));
}

#[test]
fn test_agent_load_from_dir_toml() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("coder.toml");
    let mut f = std::fs::File::create(&path).unwrap();
    writeln!(
        f,
        r#"
name = "coder"
description = "Writes code"
mode = "primary"
prompt_template = "You are a coder."

[model]
model = "claude-3-5-sonnet-20241022"
max_tokens = 8192

[permissions]
rules = []
"#
    )
    .unwrap();

    let reg = AgentRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
    let agent = reg.get("coder").unwrap();
    assert_eq!(agent.model.model, "claude-3-5-sonnet-20241022");
    assert_eq!(agent.model.max_tokens, Some(8192));
}

// ── PluginRegistry ────────────────────────────────────────────────────────────

fn write_plugin_toml(dir: &TempDir, name: &str, version: &str, perms: &[&str]) {
    let subdir = dir.path().join(name);
    std::fs::create_dir_all(&subdir).unwrap();
    let perms_toml = perms
        .iter()
        .map(|p| format!("\"{p}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let content = format!(
        r#"
[plugin]
name = "{name}"
version = "{version}"
description = "Plugin {name}"
entry_point = "{name}.wasm"
permissions = [{perms_toml}]
"#
    );
    std::fs::write(subdir.join("plugin.toml"), content).unwrap();
}

#[test]
fn test_plugin_registry_load_and_list() {
    let dir = TempDir::new().unwrap();
    write_plugin_toml(&dir, "formatter", "1.0.0", &["fs:read", "fs:write"]);
    write_plugin_toml(&dir, "linter", "0.5.0", &["fs:read"]);

    let reg = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(reg.len(), 2);

    let list = reg.list();
    // list() is sorted by name
    assert_eq!(list[0].name, "formatter");
    assert_eq!(list[1].name, "linter");
}

#[test]
fn test_plugin_registry_permissions() {
    let dir = TempDir::new().unwrap();
    write_plugin_toml(&dir, "net-plugin", "2.0.0", &["net:outbound"]);

    let reg = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
    let plugin = reg.get("net-plugin").unwrap();
    assert!(plugin.permissions.contains(&"net:outbound".to_string()));
}

#[test]
fn test_plugin_registry_bad_manifest_skipped() {
    let dir = TempDir::new().unwrap();
    write_plugin_toml(&dir, "good", "1.0.0", &[]);

    // Write a broken manifest
    let bad_dir = dir.path().join("bad");
    std::fs::create_dir_all(&bad_dir).unwrap();
    std::fs::write(bad_dir.join("plugin.toml"), "not valid toml [[[[").unwrap();

    let reg = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(reg.len(), 1);
    assert!(reg.get("good").is_some());
}

// ── Session + Agent cross-crate scenario ──────────────────────────────────────

/// Simulate an agent conversation: create a session, attach agent metadata to
/// messages, and verify the conversation thread is correct.
#[test]
fn test_session_agent_conversation_thread() {
    let conn = mem_db();

    // Load agent config
    let mut reg = AgentRegistry::new();
    reg.insert(make_agent("coder", AgentMode::Primary));
    let agent = reg.default_agent();

    assert!(agent.permissions.allows("bash", "write"));

    // Create a session for this agent's work
    let session = make_session(&conn, "proj-conv");

    // Simulate conversation: user asks, agent responds using a tool
    let meta_user = r#"{"role":"user"}"#;
    let meta_assistant = format!(r#"{{"agent":"{}","role":"assistant"}}"#, agent.name);
    let meta_tool = format!(r#"{{"agent":"{}","tool":"bash"}}"#, agent.name);

    append_message(&conn, &session.id, "user", "Write a hello world", Some(meta_user)).unwrap();
    append_message(&conn, &session.id, "assistant", "I'll write that now.", Some(&meta_assistant))
        .unwrap();
    append_message(
        &conn,
        &session.id,
        "tool",
        "echo 'hello world'",
        Some(&meta_tool),
    )
    .unwrap();
    append_message(&conn, &session.id, "tool_result", "hello world\n", None).unwrap();

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs.len(), 4);
    assert_eq!(msgs[0].role, "user");
    assert_eq!(msgs[1].role, "assistant");
    assert_eq!(msgs[2].role, "tool");
    assert_eq!(msgs[3].role, "tool_result");
    assert!(msgs[3].content.contains("hello world"));
}

/// Verify that compaction can summarise a long agent session correctly.
#[test]
fn test_session_agent_compaction_workflow() {
    let conn = mem_db();
    let session = make_session(&conn, "proj-compact-agent");

    for i in 0..10 {
        let role = if i % 2 == 0 { "user" } else { "assistant" };
        append_message(&conn, &session.id, role, &format!("turn {i}"), None).unwrap();
    }

    // Agent decides the context is too long — compact
    let summary = "Previous 10 turns summarised: user asked about X, assistant answered Y.";
    compact(&conn, &session.id, summary).unwrap();

    // Continue the conversation after compaction
    append_message(&conn, &session.id, "user", "Continue from here.", None).unwrap();

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs.len(), 2, "expected summary + new user message");
    assert_eq!(msgs[0].content, summary);
    assert_eq!(msgs[1].content, "Continue from here.");
}

// ── Plugin + Session combined ─────────────────────────────────────────────────

/// A plugin's permissions determine what tool actions it may record in a session.
#[test]
fn test_plugin_permission_gates_session_tool_call() {
    let dir = TempDir::new().unwrap();
    write_plugin_toml(&dir, "readonly", "1.0.0", &["fs:read"]);

    let reg = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
    let plugin = reg.get("readonly").unwrap();

    // Plugin may read but not write
    assert!(plugin.permissions.contains(&"fs:read".to_string()));
    assert!(!plugin.permissions.contains(&"fs:write".to_string()));

    // Simulate recording the tool call in a session
    let conn = mem_db();
    let session = make_session(&conn, "proj-plugin");
    let meta = format!(r#"{{"plugin":"{}","action":"fs:read"}}"#, plugin.name);
    append_message(&conn, &session.id, "tool", "read /etc/hosts", Some(&meta)).unwrap();

    let msgs = get_messages(&conn, &session.id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert!(msgs[0].metadata.as_deref().unwrap().contains("fs:read"));
}
