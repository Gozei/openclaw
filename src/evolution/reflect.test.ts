import { describe, expect, it } from "vitest";
import { buildReflectionEvent } from "./reflect.js";

describe("buildReflectionEvent", () => {
  it("normalizes lines and dedupes repeated values", () => {
    const event = buildReflectionEvent({
      source: "task",
      promptSummary: "  Fix   flaky CI ",
      outcomeSummary: " Updated test lane ",
      succeeded: true,
      whatWorked: [" inspect logs first ", "inspect logs first"],
      whatFailed: ["reran all tests"],
      durableFacts: [" websocket smoke fails first "],
      userPreferences: [" prefer short summaries "],
      candidateRules: [" inspect logs before reruns "],
      failureSignatures: ["TOOL:CI:ERROR:MISSING-CHECK-ANALYSIS"],
      nowMs: 100,
    });

    expect(event.promptSummary).toBe("Fix flaky CI");
    expect(event.whatWorked).toEqual(["inspect logs first"]);
    expect(event.failureSignatures).toEqual(["tool:ci:error:missing-check-analysis"]);
  });

  it("clamps confidence into range", () => {
    const low = buildReflectionEvent({
      source: "task",
      promptSummary: "A",
      outcomeSummary: "B",
      succeeded: true,
      confidence: -10,
    });
    const high = buildReflectionEvent({
      source: "task",
      promptSummary: "A",
      outcomeSummary: "B",
      succeeded: true,
      confidence: 10,
    });

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });
});
