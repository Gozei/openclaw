import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  booleanFlag,
  intFlag,
  parseFlagArgs,
  stringFlag,
  stringListFlag,
} from "./lib/arg-utils.mjs";
import { writeJsonFile } from "./test-report-utils.mjs";

type BenchmarkCaseId = "initial-render" | "draft-rerender" | "slash-menu-input";

type ChatBenchmarkCase = {
  id: BenchmarkCaseId;
  name: string;
  run: (helpers: BenchmarkHelpers) => Promise<number>;
};

type BenchmarkSummaryStats = {
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
};

type BenchmarkCaseResult = {
  id: BenchmarkCaseId;
  name: string;
  sampleCount: number;
  samplesMs: number[];
  summary: BenchmarkSummaryStats;
};

type BenchmarkOutput = {
  benchmark: "control-ui-chat";
  nodeVersion: string;
  platform: string;
  arch: string;
  messages: number;
  toolPreviews: number;
  runs: number;
  warmup: number;
  scenarios: BenchmarkCaseResult[];
};

type CliOptions = {
  runs: number;
  warmup: number;
  messages: number;
  toolPreviews: number;
  json: boolean;
  output: string | null;
  scenarios: BenchmarkCaseId[];
};

type ChatPropsModule = typeof import("../ui/src/ui/views/chat.ts");
type LitModule = typeof import("lit");
type ChatProps = import("../ui/src/ui/views/chat.ts").ChatProps;

type BenchmarkHelpers = {
  messages: number;
  toolPreviews: number;
  render: LitModule["render"];
  renderChat: ChatPropsModule["renderChat"];
  createProps: (overrides?: Partial<ChatProps>) => ChatProps;
  flushMicrotasks: () => Promise<void>;
};

const DEFAULT_RUNS = 8;
const DEFAULT_WARMUP = 2;
const DEFAULT_MESSAGES = 200;
const DEFAULT_TOOL_PREVIEWS = 1;

const SCENARIOS: readonly ChatBenchmarkCase[] = [
  {
    id: "initial-render",
    name: "Initial render (large history)",
    async run(helpers) {
      const container = document.createElement("div");
      document.body.append(container);
      const props = helpers.createProps({
        messages: createLargeHistory(helpers.messages),
        toolMessages: createToolPreviewMessages(helpers.toolPreviews),
      });
      const startedAt = process.hrtime.bigint();
      helpers.render(helpers.renderChat(props), container);
      await helpers.flushMicrotasks();
      const elapsedMs = hrtimeMs(startedAt);
      container.remove();
      return elapsedMs;
    },
  },
  {
    id: "draft-rerender",
    name: "Draft rerender (large history)",
    async run(helpers) {
      const container = document.createElement("div");
      document.body.append(container);
      const baseProps = helpers.createProps({
        messages: createLargeHistory(helpers.messages),
        toolMessages: createToolPreviewMessages(helpers.toolPreviews),
      });
      helpers.render(helpers.renderChat(baseProps), container);
      await helpers.flushMicrotasks();
      const startedAt = process.hrtime.bigint();
      helpers.render(
        helpers.renderChat({ ...baseProps, draft: "benchmark draft update" }),
        container,
      );
      await helpers.flushMicrotasks();
      const elapsedMs = hrtimeMs(startedAt);
      container.remove();
      return elapsedMs;
    },
  },
  {
    id: "slash-menu-input",
    name: "Slash menu local update",
    async run(helpers) {
      const container = document.createElement("div");
      document.body.append(container);
      let currentProps = helpers.createProps({
        messages: createLargeHistory(helpers.messages),
        toolMessages: createToolPreviewMessages(helpers.toolPreviews),
      });
      const rerender = () => {
        currentProps = { ...currentProps, onRequestUpdate: rerender };
        helpers.render(helpers.renderChat(currentProps), container);
      };
      currentProps = { ...currentProps, onRequestUpdate: rerender };
      rerender();
      await helpers.flushMicrotasks();
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      if (!textarea) {
        container.remove();
        throw new Error("Chat benchmark could not find the composer textarea.");
      }
      const startedAt = process.hrtime.bigint();
      textarea.value = "/";
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      await helpers.flushMicrotasks();
      const elapsedMs = hrtimeMs(startedAt);
      container.remove();
      return elapsedMs;
    },
  },
] as const;

function parseArgs(argv: string[]): CliOptions {
  const parsed = parseFlagArgs(
    argv,
    {
      runs: DEFAULT_RUNS,
      warmup: DEFAULT_WARMUP,
      messages: DEFAULT_MESSAGES,
      toolPreviews: DEFAULT_TOOL_PREVIEWS,
      json: false,
      output: null as string | null,
      scenarios: [] as BenchmarkCaseId[],
    },
    [
      intFlag("--runs", "runs", { min: 1 }),
      intFlag("--warmup", "warmup", { min: 0 }),
      intFlag("--messages", "messages", { min: 1 }),
      intFlag("--tool-previews", "toolPreviews", { min: 0 }),
      stringFlag("--output", "output"),
      booleanFlag("--json", "json"),
      stringListFlag("--scenario", "scenarios"),
    ],
  );
  const validScenarioIds = new Set(SCENARIOS.map((scenario) => scenario.id));
  const scenarios =
    parsed.scenarios.length > 0
      ? parsed.scenarios.map((scenario) => {
          if (!validScenarioIds.has(scenario)) {
            throw new Error(`Unknown --scenario "${scenario}".`);
          }
          return scenario;
        })
      : SCENARIOS.map((scenario) => scenario.id);
  return { ...parsed, scenarios };
}

function installDomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const globalAssignments = new Map<PropertyKey, unknown>([
    ["window", window],
    ["document", window.document],
    ["navigator", window.navigator],
    ["self", window],
    ["customElements", window.customElements],
    ["localStorage", window.localStorage],
    ["sessionStorage", window.sessionStorage],
    ["HTMLElement", window.HTMLElement],
    ["HTMLAnchorElement", window.HTMLAnchorElement],
    ["HTMLInputElement", window.HTMLInputElement],
    ["HTMLTextAreaElement", window.HTMLTextAreaElement],
    ["HTMLButtonElement", window.HTMLButtonElement],
    ["HTMLDivElement", window.HTMLDivElement],
    ["HTMLSpanElement", window.HTMLSpanElement],
    ["HTMLAudioElement", window.HTMLAudioElement],
    ["HTMLVideoElement", window.HTMLVideoElement],
    ["HTMLImageElement", window.HTMLImageElement],
    ["DocumentFragment", window.DocumentFragment],
    ["Document", window.Document],
    ["Event", window.Event],
    ["MouseEvent", window.MouseEvent],
    ["KeyboardEvent", window.KeyboardEvent],
    ["CustomEvent", window.CustomEvent],
    ["Node", window.Node],
    ["Element", window.Element],
    ["MutationObserver", window.MutationObserver],
    ["DOMParser", window.DOMParser],
    ["getComputedStyle", window.getComputedStyle.bind(window)],
    [
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    ],
    ["cancelAnimationFrame", (handle: number) => window.clearTimeout(handle)],
  ]);
  for (const [key, value] of globalAssignments) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  }
}

function createLargeHistory(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `bench-history-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    content: [
      {
        type: "text",
        text: `Benchmark history message ${index} with enough content to exercise normalization and markdown paths.`,
      },
    ],
    timestamp: index + 1,
  }));
}

function createToolPreviewMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `bench-tool-preview-${index}`,
    role: "tool",
    toolName: "canvas_render",
    content: JSON.stringify({
      kind: "canvas",
      source: {
        type: "html",
        content: `<div>Benchmark preview ${index}</div>`,
      },
      presentation: {
        target: "chat_message",
        title: `Benchmark Preview ${index}`,
      },
    }),
    timestamp: 10_000 + index,
  }));
}

function createBaseProps(sessionKey: string): ChatProps {
  return {
    sessionKey,
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    sideResult: null,
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: {
      ts: 0,
      path: "",
      count: 0,
      defaults: { modelProvider: null, model: null, contextTokens: null },
      sessions: [],
    },
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    localMediaPreviewRoots: [],
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onDismissSideResult: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "",
    onAgentChange: () => undefined,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((percentileValue / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): BenchmarkSummaryStats {
  const avg = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    avg,
    p50: median(values),
    p95: percentile(values, 95),
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}

function hrtimeMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function printHumanSummary(output: BenchmarkOutput) {
  console.log(
    [
      "OpenClaw Control UI chat benchmark",
      `node=${process.version} platform=${process.platform} ${process.arch}`,
      `messages=${String(output.messages)} toolPreviews=${String(output.toolPreviews)} runs=${String(output.runs)} warmup=${String(output.warmup)}`,
      "",
      ...output.scenarios.map(
        (scenario) =>
          `${scenario.name}: avg=${formatMs(scenario.summary.avg)} p50=${formatMs(
            scenario.summary.p50,
          )} p95=${formatMs(scenario.summary.p95)} min=${formatMs(
            scenario.summary.min,
          )} max=${formatMs(scenario.summary.max)}`,
      ),
    ].join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  installDomGlobals();
  const [{ render }, { renderChat }] = await Promise.all([
    import("lit"),
    import("../ui/src/ui/views/chat.ts"),
  ]);

  let sessionCounter = 0;
  const helpers: BenchmarkHelpers = {
    messages: options.messages,
    toolPreviews: options.toolPreviews,
    render,
    renderChat,
    createProps(overrides = {}) {
      sessionCounter += 1;
      return { ...createBaseProps(`bench-session-${sessionCounter}`), ...overrides };
    },
    flushMicrotasks: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };

  const selectedScenarios = SCENARIOS.filter((scenario) => options.scenarios.includes(scenario.id));
  const results: BenchmarkCaseResult[] = [];

  for (const scenario of selectedScenarios) {
    for (let index = 0; index < options.warmup; index += 1) {
      await scenario.run(helpers);
      document.body.innerHTML = "";
    }
    const samples: number[] = [];
    for (let index = 0; index < options.runs; index += 1) {
      samples.push(await scenario.run(helpers));
      document.body.innerHTML = "";
    }
    results.push({
      id: scenario.id,
      name: scenario.name,
      sampleCount: samples.length,
      samplesMs: samples,
      summary: summarize(samples),
    });
  }

  const output: BenchmarkOutput = {
    benchmark: "control-ui-chat",
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    messages: options.messages,
    toolPreviews: options.toolPreviews,
    runs: options.runs,
    warmup: options.warmup,
    scenarios: results,
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    writeJsonFile(outputPath, output);
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  printHumanSummary(output);
  if (options.output) {
    console.log(`\nSaved benchmark JSON to ${options.output}`);
  }
}

await main();
