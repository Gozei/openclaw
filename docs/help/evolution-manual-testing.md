---
title: "Evolution Manual Testing"
summary: "Hands-on checklist for verifying that evolution changes behavior, not just files"
read_when:
  - You want to manually validate evolution before or after a release
  - You want to confirm that generated skills and recall actually change execution
  - You need a repeatable operator checklist for evolution demos or regressions
---

# Evolution Manual Testing

This guide is for **human validation** of OpenClaw's evolution loop.

The goal is not just to confirm that files were written.
The goal is to confirm three stronger claims:

- OpenClaw captures lessons after work completes
- OpenClaw recalls relevant lessons before similar work starts
- That recall changes the next execution path in a visible way

If you want the fastest realistic scenario, start with
[Evolution CI Triage Testing](/help/evolution-ci-triage-testing).

## Best surfaces to watch

Use at least two of these during manual testing:

- **Control UI 进化 page**
  - Refresh after each run and watch counters, repeated failures, reusable workflows, generated skills, and proposals move.
- **Doctor evolution status**
  - Call `doctor.memory.evolutionStatus` from the dashboard or browser client to inspect the same snapshot without the full UI.
- **Workspace artifacts**
  - Check `memory/YYYY-MM-DD.md`
  - Check `memory/.evolution/reports/*.md`
  - Check `memory/.evolution/failures.json`
  - Check `memory/.evolution/workflows.json`
  - Check `memory/.evolution/proposals/**`
  - Check `skills/evolution-*/SKILL.md`

## Test 1: Basic Post-Task Capture

Purpose: verify that a normal task produces usable evolution artifacts.

1. Give the agent a bounded workflow task with a concrete outcome.
2. Wait for the run to finish.
3. Refresh the 进化 page.
4. Inspect the workspace artifacts.

Expected signs:

- `memory/YYYY-MM-DD.md` gets a new worked or failed note.
- `memory/.evolution/reports/YYYY-MM-DD.md` updates.
- Today's cycle count increases.
- If the task failed, the failure registry may gain a signature.

Failure signs:

- Only the chat transcript changed.
- Metrics stayed flat.
- No daily memory or report update appeared after a completed run.

## Test 2: Repeated Failure To Rule Candidate

Purpose: verify that repeated failure becomes a stronger lesson instead of staying isolated.

1. Give the agent a task that is likely to fail in a repeatable way.
2. Repeat the same or very similar task a second time.
3. Refresh the 进化 page after each run.
4. Check `memory/.evolution/failures.json` and rule proposals.

Expected signs:

- The same failure signature count increases.
- The repeated-failures card shows the signature and latest workaround.
- A rule proposal appears under `memory/.evolution/proposals/rules/`.

Failure signs:

- Two similar failures produce unrelated signatures.
- The count does not increase.
- No rule candidate appears after repeated failure.

## Test 3: Repeated Success To Generated Skill

Purpose: verify that a successful workflow is compiled into reusable procedural memory.

1. Give the agent a workflow-shaped task.
2. Repeat a very similar task until the workflow registry count reaches the promotion threshold.
3. Check both the 进化 page and `skills/evolution-*/SKILL.md`.

Expected signs:

- A skill proposal appears in `memory/.evolution/proposals/skills/`.
- A generated skill appears under `skills/evolution-*/SKILL.md`.
- The 进化 page shows the generated skill separately from the proposal.

Failure signs:

- Only a proposal is created, with no generated skill draft.
- The generated skill exists but never appears in the 进化 snapshot.

## Test 4: Preflight Recall Changes The Next Run

Purpose: verify that recall changes execution before work begins.

1. First create a generated skill using Test 3.
2. Start a new task that clearly matches that generated skill.
3. Watch the next run closely.

Expected signs:

- In Control UI chat, a short `Recall:` note appears before the main answer when preflight recall matches.
- The agent starts closer to the known workflow instead of re-deriving it.
- The agent is more likely to read or follow the generated skill path under `skills/evolution-*/SKILL.md`.
- The run avoids the repeated failure workaround listed in the recall block.

Strong pass signal:

- The second run is shorter, more direct, and avoids obvious exploration that happened on the first run.

Weak pass signal:

- Artifacts exist, but the next run behaves almost the same as a cold start.

## Test 5: Subagent Knowledge Reflux

Purpose: verify that subagent completions feed the same evolution loop.

1. Give the main agent a task that encourages spawning a subagent.
2. Let the subagent complete and announce back.
3. Refresh the 进化 page and inspect artifacts.

Expected signs:

- A new evolution cycle is recorded from a `subagent` source.
- The returned findings affect daily memory, failures, workflows, or proposals.
- A later similar delegated task is shaped by the earlier subagent findings.

Failure signs:

- The subagent helped in the moment but left no learning artifact.
- Only the detached task summary changed, with no reflected announce findings.

## Test 6: Compaction And Memory Flush As Learning Sources

Purpose: verify that context-maintenance work also enters evolution.

1. Use a long enough session to trigger memory flush or compaction.
2. After the session rotates or flushes, refresh the 进化 page.
3. Check the report and metrics.

Expected signs:

- The daily metrics record `compaction` activity.
- The report reflects a compaction-sourced evolution event.
- The daily memory or durable-memory paths referenced by flush are visible in the resulting artifacts.

Failure signs:

- Compaction happens operationally, but the evolution metrics never reflect it.

## Pass Criteria

For a strong manual pass, all of these should be true:

- Post-task artifacts appear consistently.
- Repeated failures become rule candidates.
- Repeated successful workflows become generated skills.
- A later similar run is observably shaped by recall.
- Subagent and compaction events also appear in the same learning loop.

## Still Not Hermes-Level

Even when all tests above pass, OpenClaw is still below Hermes parity if any of these remain true:

- Generated skills are present but not reliably chosen when they match.
- Recall is visible in artifacts but weak in behavior change.
- Skill lifecycle is still mostly one-way create/update, without strong disable or retirement flows.
- There is no eval proving retention, reduced recurrence, or better future performance.
