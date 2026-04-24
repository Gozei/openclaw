---
title: "Evolution CI Triage Testing"
summary: "Shortest manual test path for feeling evolution improvements in CI triage"
read_when:
  - You want the fastest manual proof that evolution changed execution
  - You want to test generated skills and recall on a realistic repo task
  - You want a scenario-specific checklist instead of the full evolution guide
---

# Evolution CI Triage Testing

This is the fastest realistic test for feeling OpenClaw's evolution changes.

Use it when you want to answer one question:

- Does the second CI triage run feel more like a practiced workflow than a cold start?

## What you need

- A repo task where CI or verification can plausibly fail
- Access to the Control UI 进化 page
- Access to the workspace files

## Round 1: Teach The Workflow

Give the agent a prompt like this:

```text
Inspect the failing CI lane on this PR. Do not rerun the whole suite blindly. Figure out the smallest useful triage path and give me a targeted rerun plan.
```

What you want from round 1:

- It talks about failing lanes, shards, checks, or targeted verification
- It does not succeed by accident with a generic answer
- It leaves behind evolution artifacts

After round 1, check:

- The 进化 page refreshed
- `skills/evolution-*/SKILL.md` exists if the workflow has repeated enough
- `memory/.evolution/workflows.json` shows a CI-like workflow key

## Round 2: Check Recall

Now give a very similar prompt:

```text
We have another PR with broken CI. Triage it efficiently. Start with the narrowest useful check instead of broad reruns.
```

Pass signs:

- A short `Recall:` note appears before the main answer in Control UI chat.
- The agent starts with failing-lane or check-output analysis
- The agent avoids broad rerun behavior early
- The agent behaves like it already knows the pattern

Strong pass signs:

- It appears to follow a known first move almost immediately
- It chooses a targeted rerun plan faster than in round 1
- The opening plan resembles the generated skill's quick start

Weak signs:

- It mentions good ideas eventually, but still wanders first
- The artifacts exist, but round 2 still feels like a cold start

## What To Inspect

Open these after round 2:

- `skills/evolution-*/SKILL.md`
- `memory/.evolution/workflows.json`
- `memory/.evolution/reports/*.md`

In the 进化 page, inspect:

- Generated skills
- Reusable workflows
- Latest report

## Exact Behavior To Compare

Compare round 1 and round 2 on these questions:

- Did round 2 inspect the failing lane earlier?
- Did round 2 avoid broad reruns earlier?
- Did round 2 produce a targeted rerun plan faster?
- Did round 2 look like it recognized the task shape?

## Failure Interpretation

If round 2 still feels flat, the likely causes are:

- The first run did not generate a strong enough workflow
- The second prompt was not similar enough to trigger recall
- Recall surfaced artifacts, but the model still did not choose them strongly enough

## Related

- Full guide: [Evolution Manual Testing](/help/evolution-manual-testing)
