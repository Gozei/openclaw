---
title: "OpenClaw Runtime V2"
summary: "Runtime V2 blueprint for hot-swappable agents, runtime snapshots, and typed agent state"
read_when:
  - You are redesigning OpenClaw's runtime, agent model, or Control UI state flow
  - You need a migration plan from restart-heavy config changes to session-scoped runtime changes
---

# OpenClaw Runtime V2

## Why this exists

OpenClaw already supports config watching and partial hot reload, but the user experience still feels
restart-heavy for three reasons:

- model and agent changes are expressed mostly as config mutations, not session-scoped runtime overrides
- plugin and capability assembly still leans on startup-time bootstrap
- UI/channel surfaces see raw agent events, but not one normalized runtime state machine

Runtime V2 closes that gap by shifting OpenClaw from a startup-assembled gateway to a versioned,
observable agent runtime.

## Goals

- Change model, agent, tools, and permissions without restarting the gateway
- Apply new runtime settings to new turns immediately without interrupting in-flight turns
- Represent agent execution as a typed state machine instead of inferred log output
- Make subagents, approvals, background tasks, and blocked runs visible in UI and channel surfaces
- Reduce turn latency by moving from full bootstrap reinjection to incremental context compilation

## Core ideas

### 1. Runtime snapshots

Every effective runtime configuration becomes a `RuntimeSnapshot`:

- config layers: managed, user, project, local
- agent spec overlays
- session overrides
- resolved model/provider/auth/tool policy

Each new turn binds to one snapshot version. In-flight turns keep their current version until they
finish. This removes the need to restart the process just to preserve consistency.

### 2. Session-scoped overrides

Model switching, agent switching, and permission mode changes should update session runtime state,
not global process state.

Examples:

- `/model openai-codex/gpt-5.4` updates the current session override
- `/agent reviewer` switches the active session agent spec
- permission mode changes affect only future tool calls in that session unless explicitly promoted

### 3. File-based agent specs

OpenClaw should support agent specs as first-class project files:

- `~/.openclaw/agents/*.md` or `*.toml` for user-level reusable agents
- `.openclaw/agents/*.md` or `*.toml` for project-scoped agents

Each spec can declare:

- instructions
- default model and effort
- tool/skill allowlists
- sandbox defaults
- visibility and handoff policy

### 4. Typed runtime state

Raw agent events are necessary but not sufficient. Runtime V2 introduces a normalized state layer
that projects event streams into user-facing status such as:

- `running`
- `blocked`
- `completed`
- `failed`
- `cancelled`

This state machine becomes the source of truth for:

- Control UI run cards
- channel status replies
- operator diagnostics
- background task dashboards

### 5. Event-first orchestration

Notifications, approvals, subagent completion, and blocked-task handling should be driven by typed
events, not scraped logs or implicit prompt output.

Representative event families:

- `agent.runtime.changed`
- `agent.snapshot.changed`
- `agent.blocked`
- `agent.unblocked`
- `subagent.spawned`
- `subagent.finished`
- `session.override.changed`

## Migration plan

### Phase 1: normalize runtime state

Ship a projection layer over existing agent events.

- add runtime snapshot/status storage
- track blocked vs running vs terminal states
- expose runtime state to UI and diagnostics

### Phase 2: introduce runtime snapshot versions

- derive immutable effective runtime snapshots
- bind new turns to latest snapshot
- keep in-flight runs on their original snapshot

### Phase 3: file-based agents and session overrides

- add `.openclaw/agents/`
- support user/project/local merge rules
- switch `/model` and `/agent` to write session-scoped overrides first

### Phase 4: capability hot-swap

- move more plugin/capability resolution out of startup bootstrap
- allow safe registry swaps for new turns
- keep restart only for true process-level surfaces

### Phase 5: context compiler

- replace repeated bootstrap reinjection with cached workspace summaries and diff-based refresh
- reserve full bootstrap reconstruction for cold starts, compaction recovery, and explicit resets

## Immediate implementation notes

The first concrete Runtime V2 step is already straightforward inside the current architecture:

- keep `infra/agent-events.ts` as the raw bus
- project those events into a normalized runtime state map
- use that map as the next source for UI and diagnostics instead of re-deriving status ad hoc

That lets OpenClaw improve observability and unblock later hot-swap work without a risky rewrite.
