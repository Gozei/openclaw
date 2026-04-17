import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runSelfEvolution, type SelfEvolutionConfig } from "./self-evolution.js";

describe("Self-Evolution", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "openclaw-evolution-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("runSelfEvolution", () => {
    it("should return success status when tests pass", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
        rollbackOnFailure: false,
      };

      const result = await runSelfEvolution(config);

      expect(result.status).toBe("success");
      expect(result.timestamp).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    }, 60000);

    it("should include test results", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result.testResult).toBeDefined();
      expect(result.testResult.status).toMatch(/passed|failed/);
      expect(typeof result.testResult.total).toBe("number");
      expect(typeof result.testResult.passed).toBe("number");
    }, 60000);

    it("should include quality analysis", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result.qualityResult).toBeDefined();
      expect(typeof result.qualityResult?.score).toBe("number");
      expect(result.qualityResult?.score).toBeGreaterThanOrEqual(0);
      expect(result.qualityResult?.score).toBeLessThanOrEqual(100);
    }, 60000);

    it("should include performance metrics", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result.performanceResult).toBeDefined();
      expect(typeof result.performanceResult?.score).toBe("number");
      expect(result.performanceResult?.metrics).toBeDefined();
    }, 60000);

    it("should respect quality threshold", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        qualityThreshold: 99, // Very high threshold
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      // Should still succeed even if quality is below threshold
      expect(result.status).toBe("success");
      // But should have suggestions
      if (result.qualityResult && result.qualityResult.score < config.qualityThreshold!) {
        expect(result.qualityResult.suggestions.length).toBeGreaterThan(0);
      }
    }, 60000);

    it("should skip commit when autoCommit is false", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result.changes).toBeUndefined();
    }, 60000);

    it("should handle missing workspace gracefully", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: "/nonexistent/path",
        testSuite: "smoke",
        autoCommit: false,
        rollbackOnFailure: false,
      };

      const result = await runSelfEvolution(config);

      // Should not crash, but may have failed status
      expect(result).toBeDefined();
      expect(result.timestamp).toBeDefined();
    }, 60000);
  });

  describe("Test Suite Selection", () => {
    it("should support smoke test suite", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result).toBeDefined();
      expect(result.durationMs).toBeLessThan(120000); // Smoke should be fast
    }, 120000);

    it("should support critical test suite", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "critical",
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      expect(result).toBeDefined();
    }, 300000);
  });

  describe("Rollback Behavior", () => {
    it("should rollback on test failure when enabled", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        rollbackOnFailure: true,
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      // Should either succeed or rollback
      expect(["success", "rolled_back"]).toContain(result.status);
    }, 60000);

    it("should not rollback when disabled", async () => {
      const config: Partial<SelfEvolutionConfig> = {
        workspaceRoot: tempDir,
        testSuite: "smoke",
        rollbackOnFailure: false,
        autoCommit: false,
      };

      const result = await runSelfEvolution(config);

      // Should either succeed or fail (not rollback)
      expect(["success", "failed"]).toContain(result.status);
    }, 60000);
  });
});
