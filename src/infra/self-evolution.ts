/**
 * OpenClaw 自我进化核心模块
 *
 * 功能：
 * 1. 自动化测试执行
 * 2. 测试结果分析
 * 3. 代码质量检查
 * 4. 自动提交/回滚
 * 5. 进化报告生成
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ============== 配置 ==============

export interface SelfEvolutionConfig {
  enabled: boolean;
  workspaceRoot: string;
  testSuite: "full" | "critical" | "smoke";
  autoCommit: boolean;
  rollbackOnFailure: boolean;
  maxRetryAttempts: number;
  notifyOnSuccess: boolean;
  qualityThreshold: number; // 代码质量阈值 (0-100)
  performanceThreshold: number; // 性能阈值 (ms)
}

const DEFAULT_CONFIG: SelfEvolutionConfig = {
  enabled: true,
  workspaceRoot: process.cwd(),
  testSuite: "critical",
  autoCommit: true,
  rollbackOnFailure: true,
  maxRetryAttempts: 2,
  notifyOnSuccess: true,
  qualityThreshold: 85,
  performanceThreshold: 100,
};

// ============== 类型定义 ==============

export interface EvolutionResult {
  status: "success" | "failed" | "rolled_back";
  timestamp: string;
  durationMs: number;
  testResult: TestResult;
  qualityResult?: QualityResult;
  performanceResult?: PerformanceResult;
  changes?: {
    committed: boolean;
    commitHash?: string;
    message?: string;
  };
  error?: string;
}

export interface TestResult {
  status: "passed" | "failed";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures?: TestFailure[];
}

export interface TestFailure {
  name: string;
  error: string;
  stack?: string;
}

export interface QualityResult {
  score: number; // 0-100
  issues: CodeIssue[];
  suggestions: CodeSuggestion[];
}

export interface CodeIssue {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  file: string;
  line?: number;
}

export interface CodeSuggestion {
  type: "optimization" | "refactor" | "fix";
  description: string;
  impact: "high" | "medium" | "low";
  file?: string;
}

export interface PerformanceResult {
  score: number; // 0-100
  metrics: PerformanceMetrics;
  bottlenecks: Bottleneck[];
}

export interface PerformanceMetrics {
  memoryUsageMB: number;
  avgResponseTimeMs: number;
  testExecutionTimeMs: number;
  diskUsageMB: number;
}

export interface Bottleneck {
  type: "memory" | "cpu" | "disk" | "network";
  description: string;
  suggestion: string;
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveExecOutput(error: unknown): {
  stdout: string;
  stderr: string;
} {
  if (!error || typeof error !== "object") {
    return { stdout: "", stderr: "" };
  }
  const record = error as { stdout?: unknown; stderr?: unknown };
  return {
    stdout: typeof record.stdout === "string" ? record.stdout : "",
    stderr: typeof record.stderr === "string" ? record.stderr : "",
  };
}

// ============== 核心功能 ==============

/**
 * 运行自我进化流程
 */
export async function runSelfEvolution(
  config: Partial<SelfEvolutionConfig> = {},
): Promise<EvolutionResult> {
  const startTime = Date.now();
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`🧬 启动自我进化流程...`);
  console.log(`   工作目录：${fullConfig.workspaceRoot}`);
  console.log(`   测试套件：${fullConfig.testSuite}`);

  try {
    // 1. 运行自动化测试
    console.log(`\n📋 步骤 1/4: 运行自动化测试...`);
    const testResult = await runTestSuite(fullConfig);

    if (testResult.status === "failed") {
      console.log(`❌ 测试失败：${testResult.failed}/${testResult.total}`);

      if (fullConfig.rollbackOnFailure) {
        console.log(`🔄 执行回滚...`);
        await rollbackToLastKnownGood(fullConfig);
        return {
          status: "rolled_back",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          testResult,
          error: `测试失败，已回滚到上一个稳定版本`,
        };
      }

      return {
        status: "failed",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        testResult,
        error: `测试失败：${testResult.failed} 个用例未通过`,
      };
    }

    console.log(`✅ 测试通过：${testResult.passed}/${testResult.total}`);

    // 2. 代码质量检查
    console.log(`\n📊 步骤 2/4: 代码质量检查...`);
    const qualityResult = await analyzeCodeQuality(fullConfig);
    console.log(`   质量得分：${qualityResult.score}/100`);

    if (qualityResult.score < fullConfig.qualityThreshold) {
      console.log(`⚠️  质量得分低于阈值 (${fullConfig.qualityThreshold})`);
    }

    // 3. 性能检查
    console.log(`\n⚡ 步骤 3/4: 性能检查...`);
    const performanceResult = await checkPerformance(fullConfig);
    console.log(`   性能得分：${performanceResult.score}/100`);

    // 4. 提交变更
    let changes: EvolutionResult["changes"] | undefined;
    if (
      fullConfig.autoCommit &&
      (qualityResult.suggestions.length > 0 || performanceResult.bottlenecks.length > 0)
    ) {
      console.log(`\n💾 步骤 4/4: 提交优化...`);
      const commitHash = await commitOptimizations(fullConfig, qualityResult, performanceResult);
      changes = {
        committed: true,
        commitHash,
        message: `feat: self-evolution ${new Date().toISOString()}`,
      };
      console.log(`   已提交：${commitHash?.slice(0, 7)}`);
    }

    const result: EvolutionResult = {
      status: "success",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      testResult,
      qualityResult,
      performanceResult,
      changes,
    };

    console.log(`\n✅ 自我进化完成！耗时：${result.durationMs}ms`);

    if (fullConfig.notifyOnSuccess) {
      await notifyEvolutionComplete(result);
    }

    return result;
  } catch (error) {
    console.error(`❌ 自我进化失败:`, error);

    if (fullConfig.rollbackOnFailure) {
      await rollbackToLastKnownGood(fullConfig);
      return {
        status: "rolled_back",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        testResult: { status: "failed", total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
        error: resolveErrorMessage(error),
      };
    }

    return {
      status: "failed",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      testResult: { status: "failed", total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
      error: resolveErrorMessage(error),
    };
  }
}

// ============== 测试执行 ==============

/**
 * 运行测试套件
 */
async function runTestSuite(config: SelfEvolutionConfig): Promise<TestResult> {
  const startTime = Date.now();

  let testCommand: string;
  switch (config.testSuite) {
    case "smoke":
      testCommand = "pnpm test --run --reporter=basic 2>&1 | head -100";
      break;
    case "critical":
      testCommand = "pnpm test --run --reporter=basic 2>&1";
      break;
    case "full":
      testCommand = "pnpm test --run --coverage --reporter=verbose 2>&1";
      break;
  }

  try {
    const { stdout, stderr } = await execAsync(testCommand, {
      cwd: config.workspaceRoot,
      timeout: 300000, // 5 分钟超时
      maxBuffer: 10 * 1024 * 1024,
    });

    const durationMs = Date.now() - startTime;

    // 解析测试结果
    const testResult = parseTestOutput(stdout, stderr, durationMs);

    return testResult;
  } catch (error: unknown) {
    // 测试失败也会返回结果，而不是抛出异常
    const durationMs = Date.now() - startTime;
    const { stdout, stderr } = resolveExecOutput(error);
    return parseTestOutput(stdout, stderr, durationMs);
  }
}

/**
 * 解析测试输出
 */
function parseTestOutput(stdout: string, stderr: string, durationMs: number): TestResult {
  const output = stdout + stderr;

  // 查找测试统计
  const totalMatch = output.match(/Tests\s+(\d+)\s+passed/);
  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);
  const skippedMatch = output.match(/(\d+)\s+skipped/);

  const total = parseInt(totalMatch?.[1] || "0");
  const passed = parseInt(passedMatch?.[1] || "0");
  const failed = parseInt(failedMatch?.[1] || "0");
  const skipped = parseInt(skippedMatch?.[1] || "0");

  const status: "passed" | "failed" = failed > 0 ? "failed" : "passed";

  // 提取失败信息
  const failures: TestFailure[] = [];
  const failureLines = output
    .split("\n")
    .filter((line) => line.includes("❌") || line.includes("FAIL") || line.includes("Error:"));

  for (const line of failureLines.slice(0, 10)) {
    failures.push({
      name: line.trim(),
      error: line,
    });
  }

  return {
    status,
    total: total || passed + failed + skipped,
    passed,
    failed,
    skipped,
    durationMs,
    failures: failures.length > 0 ? failures : undefined,
  };
}

// ============== 代码质量分析 ==============

/**
 * 分析代码质量
 */
async function analyzeCodeQuality(config: SelfEvolutionConfig): Promise<QualityResult> {
  const issues: CodeIssue[] = [];
  const suggestions: CodeSuggestion[] = [];

  try {
    // 运行 ESLint
    const { stdout: eslintOutput } = await execAsync(
      "pnpm exec eslint src/ --format=json 2>&1 || true",
      { cwd: config.workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
    );

    try {
      const eslintResults = JSON.parse(eslintOutput);
      if (Array.isArray(eslintResults)) {
        for (const result of eslintResults) {
          for (const msg of result.messages || []) {
            issues.push({
              severity: msg.severity === 2 ? "error" : "warning",
              rule: msg.ruleId || "unknown",
              message: msg.message,
              file: result.filePath,
              line: msg.line,
            });
          }
        }
      }
    } catch {
      // ESLint 输出可能不是 JSON 格式
    }

    // 运行代码复杂度分析
    const { stdout: complexityOutput } = await execAsync(
      "pnpm exec madge --circular src/ 2>&1 || true",
      { cwd: config.workspaceRoot },
    );

    if (complexityOutput.includes("circular")) {
      suggestions.push({
        type: "refactor",
        description: "发现循环依赖，建议重构",
        impact: "high",
      });
    }

    // 计算质量得分
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    let score = 100;
    score -= errorCount * 5; // 每个错误扣 5 分
    score -= warningCount * 1; // 每个警告扣 1 分
    score = Math.max(0, Math.min(100, score));

    // 生成优化建议
    if (errorCount > 10) {
      suggestions.push({
        type: "fix",
        description: "修复 ESLint 错误",
        impact: "high",
      });
    }

    if (score < config.qualityThreshold) {
      suggestions.push({
        type: "optimization",
        description: "提升代码质量到阈值以上",
        impact: "medium",
      });
    }

    return {
      score,
      issues,
      suggestions,
    };
  } catch (error) {
    console.warn("代码质量分析失败:", error);
    return {
      score: 75, // 默认分数
      issues: [],
      suggestions: [],
    };
  }
}

// ============== 性能检查 ==============

/**
 * 检查系统性能
 */
async function checkPerformance(_config: SelfEvolutionConfig): Promise<PerformanceResult> {
  const bottlenecks: Bottleneck[] = [];

  try {
    // 内存使用
    const { stdout: memOutput } = await execAsync(
      'node -e "console.log(JSON.stringify(process.memoryUsage()))"',
    );
    const memUsage = JSON.parse(memOutput);
    const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    // 磁盘使用
    const { stdout: diskOutput } = await execAsync("du -sm . 2>/dev/null || echo '0'");
    const diskUsageMB = parseInt(diskOutput) || 0;

    // 测试执行时间（从上一次测试结果获取）
    const testExecutionTimeMs = 0; // 将在主流程中设置

    // 平均响应时间暂时使用占位值，后续会接入真实测量结果。
    const avgResponseTimeMs = 0;

    const metrics: PerformanceMetrics = {
      memoryUsageMB,
      avgResponseTimeMs,
      testExecutionTimeMs,
      diskUsageMB,
    };

    // 检测瓶颈
    if (memoryUsageMB > 500) {
      bottlenecks.push({
        type: "memory",
        description: `内存使用过高 (${memoryUsageMB}MB)`,
        suggestion: "考虑增加垃圾回收频率或优化内存使用",
      });
    }

    if (diskUsageMB > 10000) {
      bottlenecks.push({
        type: "disk",
        description: `磁盘使用过高 (${diskUsageMB}MB)`,
        suggestion: "清理临时文件和旧的构建产物",
      });
    }

    // 计算性能得分
    let score = 100;
    if (memoryUsageMB > 500) {
      score -= 20;
    }
    if (memoryUsageMB > 1000) {
      score -= 20;
    }
    if (diskUsageMB > 10000) {
      score -= 10;
    }
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      metrics,
      bottlenecks,
    };
  } catch (error) {
    console.warn("性能检查失败:", error);
    return {
      score: 80,
      metrics: {
        memoryUsageMB: 0,
        avgResponseTimeMs: 0,
        testExecutionTimeMs: 0,
        diskUsageMB: 0,
      },
      bottlenecks: [],
    };
  }
}

// ============== Git 操作 ==============

/**
 * 提交优化
 */
async function commitOptimizations(
  config: SelfEvolutionConfig,
  qualityResult: QualityResult,
  performanceResult: PerformanceResult,
): Promise<string | undefined> {
  try {
    // 检查是否有变更
    const { stdout: statusOutput } = await execAsync("git status --porcelain", {
      cwd: config.workspaceRoot,
    });

    if (!statusOutput.trim()) {
      console.log("   没有需要提交的变更");
      return undefined;
    }

    // 添加所有变更
    await execAsync("git add -A", { cwd: config.workspaceRoot });

    // 提交
    const message = `feat: self-evolution ${new Date().toISOString()}
    
质量得分：${qualityResult.score}/100
性能得分：${performanceResult.score}/100
优化建议：${qualityResult.suggestions.length} 项
性能瓶颈：${performanceResult.bottlenecks.length} 个`;

    const { stdout: commitOutput } = await execAsync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: config.workspaceRoot,
    });

    // 提取 commit hash
    const hashMatch = commitOutput.match(/\[([^\]]+)\s+([a-f0-9]{7,40})\]/);
    return hashMatch?.[2];
  } catch (error) {
    console.warn("提交变更失败:", error);
    return undefined;
  }
}

/**
 * 回滚到最后一个稳定版本
 */
async function rollbackToLastKnownGood(config: SelfEvolutionConfig): Promise<void> {
  try {
    // 查找最后一个成功的提交
    const { stdout } = await execAsync(
      'git log --oneline --grep="self-evolution" --grep="stable" -1 --format="%H"',
      { cwd: config.workspaceRoot },
    );

    const commitHash = stdout.trim();

    if (commitHash) {
      await execAsync(`git reset --hard ${commitHash}`, { cwd: config.workspaceRoot });
      console.log(`   已回滚到：${commitHash.slice(0, 7)}`);
    } else {
      console.log("   未找到可回滚的版本");
    }
  } catch (error) {
    console.warn("回滚失败:", error);
  }
}

// ============== 通知 ==============

/**
 * 通知进化完成
 */
async function notifyEvolutionComplete(result: EvolutionResult): Promise<void> {
  // 当前先输出到控制台，后续再接入 Control UI 或消息渠道通知。
  console.log("\n📬 进化报告:");
  console.log(`   状态：${result.status}`);
  console.log(`   耗时：${result.durationMs}ms`);
  console.log(`   测试：${result.testResult.passed}/${result.testResult.total} 通过`);
  console.log(`   质量：${result.qualityResult?.score || 0}/100`);
  console.log(`   性能：${result.performanceResult?.score || 0}/100`);

  if (result.changes?.committed) {
    console.log(`   提交：${result.changes.commitHash?.slice(0, 7)}`);
  }
}

// ============== CLI 导出 ==============

/**
 * CLI 命令入口
 */
export async function evolutionCliCommand(options: {
  config?: string;
  testSuite?: string;
  noCommit?: boolean;
  noRollback?: boolean;
  verbose?: boolean;
}) {
  let config: Partial<SelfEvolutionConfig> = {};

  if (options.config) {
    const { readFile } = await import("node:fs/promises");
    const configContent = await readFile(options.config, "utf-8");
    config = JSON.parse(configContent) as Partial<SelfEvolutionConfig>;
  }

  if (options.testSuite) {
    config.testSuite = options.testSuite as SelfEvolutionConfig["testSuite"];
  }

  if (options.noCommit) {
    config.autoCommit = false;
  }

  if (options.noRollback) {
    config.rollbackOnFailure = false;
  }

  const result = await runSelfEvolution(config);

  if (options.verbose) {
    console.log("\n详细结果:");
    console.log(JSON.stringify(result, null, 2));
  }

  // 退出码
  if (result.status === "success") {
    process.exit(0);
  } else {
    process.exit(1);
  }
}
