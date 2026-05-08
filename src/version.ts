import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizeOptionalString } from "./shared/string-coerce.js";

declare const __OPENCLAW_VERSION__: string | undefined;
const CORE_PACKAGE_NAME = "openclaw";

type RuntimePackageJson = {
  name?: string;
  version?: string;
  exports?: Record<string, unknown>;
  bin?: string | Record<string, unknown>;
};

const PACKAGE_JSON_CANDIDATES = [
  "../package.json",
  "../../package.json",
  "../../../package.json",
  "./package.json",
] as const;

const BUILD_INFO_CANDIDATES = [
  "../build-info.json",
  "../../build-info.json",
  "./build-info.json",
] as const;

function readVersionFromJsonCandidates(
  moduleUrl: string,
  candidates: readonly string[],
  opts: { requirePackageName?: boolean } = {},
): string | null {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of candidates) {
      try {
        const parsed = require(candidate) as RuntimePackageJson;
        const version = normalizeOptionalString(parsed.version);
        if (!version) {
          continue;
        }
        const resolvedCandidatePath = require.resolve(candidate);
        if (
          opts.requirePackageName &&
          !isTrustedRuntimePackageJson({
            packageJson: parsed,
            packageJsonPath: resolvedCandidatePath,
          })
        ) {
          continue;
        }
        return version;
      } catch {
        // ignore missing or unreadable candidate
      }
    }
    return null;
  } catch {
    return null;
  }
}

function hasOpenClawBin(bin: RuntimePackageJson["bin"]): boolean {
  return (
    (typeof bin === "string" && normalizeOptionalString(bin)?.includes("openclaw")) ||
    (typeof bin === "object" && bin !== null && typeof bin.openclaw === "string")
  );
}

function hasPluginSdkRootExport(exportsMap: RuntimePackageJson["exports"]): boolean {
  return (
    typeof exportsMap === "object" &&
    exportsMap !== null &&
    Object.prototype.hasOwnProperty.call(exportsMap, "./plugin-sdk")
  );
}

function hasCliEntryExport(exportsMap: RuntimePackageJson["exports"]): boolean {
  return (
    typeof exportsMap === "object" &&
    exportsMap !== null &&
    Object.prototype.hasOwnProperty.call(exportsMap, "./cli-entry")
  );
}

function isTrustedRuntimePackageJson(params: {
  packageJson: RuntimePackageJson;
  packageJsonPath: string;
}): boolean {
  if (params.packageJson.name === CORE_PACKAGE_NAME) {
    return true;
  }
  if (!hasPluginSdkRootExport(params.packageJson.exports)) {
    return false;
  }
  if (hasCliEntryExport(params.packageJson.exports) || hasOpenClawBin(params.packageJson.bin)) {
    return true;
  }
  return fs.existsSync(path.join(path.dirname(params.packageJsonPath), "openclaw.mjs"));
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = normalizeOptionalString(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function readVersionFromPackageJsonForModuleUrl(moduleUrl: string): string | null {
  return readVersionFromJsonCandidates(moduleUrl, PACKAGE_JSON_CANDIDATES, {
    requirePackageName: true,
  });
}

export function readVersionFromBuildInfoForModuleUrl(moduleUrl: string): string | null {
  return readVersionFromJsonCandidates(moduleUrl, BUILD_INFO_CANDIDATES);
}

export function resolveVersionFromModuleUrl(moduleUrl: string): string | null {
  return (
    readVersionFromPackageJsonForModuleUrl(moduleUrl) ||
    readVersionFromBuildInfoForModuleUrl(moduleUrl)
  );
}

export function resolveBinaryVersion(params: {
  moduleUrl: string;
  injectedVersion?: string;
  bundledVersion?: string;
  fallback?: string;
}): string {
  return (
    firstNonEmpty(params.injectedVersion) ||
    resolveVersionFromModuleUrl(params.moduleUrl) ||
    firstNonEmpty(params.bundledVersion) ||
    params.fallback ||
    "0.0.0"
  );
}

export type RuntimeVersionEnv = {
  [key: string]: string | undefined;
};

export const RUNTIME_SERVICE_VERSION_FALLBACK = "unknown";
type RuntimeVersionPreference = "env-first" | "runtime-first";

export function resolveUsableRuntimeVersion(version: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(version);
  // "0.0.0" is the resolver's hard fallback when module metadata cannot be read.
  // Prefer explicit service/package markers in that edge case.
  if (!trimmed || trimmed === "0.0.0") {
    return undefined;
  }
  return trimmed;
}

function resolveVersionFromRuntimeSources(params: {
  env: RuntimeVersionEnv;
  runtimeVersion: string | undefined;
  fallback: string;
  preference: RuntimeVersionPreference;
}): string {
  const preferredCandidates =
    params.preference === "env-first"
      ? [params.env["OPENCLAW_VERSION"], params.runtimeVersion]
      : [params.runtimeVersion, params.env["OPENCLAW_VERSION"]];
  return (
    firstNonEmpty(
      ...preferredCandidates,
      params.env["OPENCLAW_SERVICE_VERSION"],
      params.env["npm_package_version"],
    ) ?? params.fallback
  );
}

export function resolveRuntimeServiceVersion(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
  fallback = RUNTIME_SERVICE_VERSION_FALLBACK,
): string {
  return resolveVersionFromRuntimeSources({
    env,
    runtimeVersion: resolveUsableRuntimeVersion(VERSION),
    fallback,
    preference: "env-first",
  });
}

export function resolveCompatibilityHostVersion(
  env: RuntimeVersionEnv = process.env as RuntimeVersionEnv,
  fallback = RUNTIME_SERVICE_VERSION_FALLBACK,
): string {
  const explicitCompatibilityVersion = firstNonEmpty(env.OPENCLAW_COMPATIBILITY_HOST_VERSION);
  if (explicitCompatibilityVersion) {
    return explicitCompatibilityVersion;
  }
  return resolveVersionFromRuntimeSources({
    env,
    runtimeVersion: resolveUsableRuntimeVersion(VERSION),
    fallback,
    preference: env === (process.env as RuntimeVersionEnv) ? "runtime-first" : "env-first",
  });
}

// Single source of truth for the current OpenClaw version.
// - Embedded/bundled builds: injected define or env var.
// - Dev/npm builds: package.json.
export const VERSION = resolveBinaryVersion({
  moduleUrl: import.meta.url,
  injectedVersion: typeof __OPENCLAW_VERSION__ === "string" ? __OPENCLAW_VERSION__ : undefined,
  bundledVersion: process.env.OPENCLAW_BUNDLED_VERSION,
});
