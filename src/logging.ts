import type { ConsoleLoggerSettings, ConsoleStyle } from "./logging/console.js";
import {
  enableConsoleCapture,
  getConsoleSettings,
  getResolvedConsoleSettings,
  routeLogsToStderr,
  setConsoleSubsystemFilter,
  setConsoleConfigLoaderForTests,
  setConsoleTimestampPrefix,
  shouldLogSubsystemToConsole,
} from "./logging/console.js";
import type { LogLevel } from "./logging/levels.js";
import { ALLOWED_LOG_LEVELS, levelToMinLevel, normalizeLogLevel } from "./logging/levels.js";
import type { LoggerResolvedSettings, LoggerSettings, PinoLikeLogger } from "./logging/logger.js";
import {
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_FILE,
  getChildLogger,
  getLogger,
  getResolvedLoggerSettings,
  isFileLogLevelEnabled,
  resetLogger,
  setLoggerOverride,
  toPinoLikeLogger,
} from "./logging/logger.js";
import type {
  PerfEvent,
  PerfEventKind,
  PerfOutcome,
  PerfSpan,
  PerfThresholds,
} from "./logging/perf.js";
import {
  createPerfEvent,
  finishPerfSpan,
  getDefaultPerfThresholds,
  isSlowPerfEvent,
  logPerfEvent,
  startPerfSpan,
} from "./logging/perf.js";
import type { RuntimeSamplerHandle, RuntimeSamplerOptions } from "./logging/runtime-sampler.js";
import { startRuntimeSampler } from "./logging/runtime-sampler.js";
import type { SubsystemLogger } from "./logging/subsystem.js";
import {
  createSubsystemLogger,
  createSubsystemRuntime,
  runtimeForLogger,
  stripRedundantSubsystemPrefixForConsole,
} from "./logging/subsystem.js";
import type { TraceContext } from "./logging/trace-context.js";
import {
  createTraceContext,
  deriveTraceContext,
  withTraceDefaults,
} from "./logging/trace-context.js";

export {
  enableConsoleCapture,
  getConsoleSettings,
  getResolvedConsoleSettings,
  routeLogsToStderr,
  setConsoleSubsystemFilter,
  setConsoleConfigLoaderForTests,
  setConsoleTimestampPrefix,
  shouldLogSubsystemToConsole,
  ALLOWED_LOG_LEVELS,
  levelToMinLevel,
  normalizeLogLevel,
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_FILE,
  getChildLogger,
  getLogger,
  getResolvedLoggerSettings,
  isFileLogLevelEnabled,
  resetLogger,
  setLoggerOverride,
  toPinoLikeLogger,
  createSubsystemLogger,
  createSubsystemRuntime,
  runtimeForLogger,
  stripRedundantSubsystemPrefixForConsole,
  createPerfEvent,
  finishPerfSpan,
  getDefaultPerfThresholds,
  isSlowPerfEvent,
  logPerfEvent,
  startPerfSpan,
  startRuntimeSampler,
  createTraceContext,
  deriveTraceContext,
  withTraceDefaults,
};

export type {
  ConsoleLoggerSettings,
  ConsoleStyle,
  LogLevel,
  PerfEvent,
  PerfEventKind,
  PerfOutcome,
  PerfSpan,
  PerfThresholds,
  RuntimeSamplerHandle,
  RuntimeSamplerOptions,
  TraceContext,
  LoggerResolvedSettings,
  LoggerSettings,
  PinoLikeLogger,
  SubsystemLogger,
};
