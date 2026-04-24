import { describe, expect, it } from "vitest";
import { toFailureCountMap, upsertFailureSignatures } from "./failure-registry.js";

describe("upsertFailureSignatures", () => {
  it("adds a new signature", () => {
    const next = upsertFailureSignatures({
      entries: [],
      signatures: ["tool:git:error:timeout"],
      nowMs: 100,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      signature: "tool:git:error:timeout",
      count: 1,
      firstSeenAt: 100,
      lastSeenAt: 100,
      promotedToRule: false,
      promotedToSkill: false,
    });
  });

  it("increments an existing signature", () => {
    const next = upsertFailureSignatures({
      entries: [
        {
          signature: "tool:git:error:timeout",
          count: 2,
          firstSeenAt: 10,
          lastSeenAt: 20,
          promotedToRule: false,
          promotedToSkill: false,
        },
      ],
      signatures: ["tool:git:error:timeout"],
      nowMs: 50,
    });

    expect(next[0]?.count).toBe(3);
    expect(next[0]?.lastSeenAt).toBe(50);
  });

  it("returns a stable failure count map", () => {
    const map = toFailureCountMap([
      {
        signature: "a",
        count: 2,
        firstSeenAt: 1,
        lastSeenAt: 2,
        promotedToRule: false,
        promotedToSkill: false,
      },
    ]);

    expect(map.get("a")).toBe(2);
  });
});
