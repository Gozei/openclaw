import fs from "node:fs";
import { describe, expect, it } from "vitest";

type MicrosoftPackageManifest = {
  dependencies?: Record<string, string>;
  openclaw?: {
    bundle?: {
      stageRuntimeDependencies?: boolean;
    };
  };
};

describe("microsoft package manifest", () => {
  it("opts into staging bundled runtime dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as MicrosoftPackageManifest;

    expect(packageJson.dependencies?.["node-edge-tts"]).toBeDefined();
    expect(packageJson.openclaw?.bundle?.stageRuntimeDependencies).toBe(true);
  });
});
