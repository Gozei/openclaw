#!/usr/bin/env node

/**
 * 运行首次自我进化测试
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runSelfEvolution } from "../src/infra/self-evolution.js";

async function runFirstEvolution() {
  console.log("🧬 运行首次自我进化测试...\n");

  const config = {
    testSuite: "smoke" as const,
    autoCommit: false,
    rollbackOnFailure: false,
    workspaceRoot: process.cwd(),
  };

  const result = await runSelfEvolution(config);

  // 保存结果
  const evolutionDir = path.join(process.env.HOME || "~", ".openclaw/evolution");
  await fs.mkdir(evolutionDir, { recursive: true });

  // 保存上次运行结果
  await fs.writeFile(
    path.join(evolutionDir, "last-run.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );

  // 添加到历史记录
  const historyFile = path.join(evolutionDir, "history.json");
  let history = [];
  try {
    const content = await fs.readFile(historyFile, "utf-8");
    history = JSON.parse(content);
  } catch {
    // 文件不存在
  }

  history.push(result);
  await fs.writeFile(historyFile, JSON.stringify(history, null, 2), "utf-8");

  console.log("\n✅ 首次自我进化测试完成！");
  console.log(`📁 结果已保存到：${evolutionDir}`);
  console.log(`\n运行以下命令查看状态:`);
  console.log(`  openclaw evolve status`);
  console.log(`  openclaw evolve history`);

  // 退出码
  process.exit(result.status === "success" ? 0 : 1);
}

runFirstEvolution().catch((error) => {
  console.error("❌ 运行失败:", error);
  process.exit(1);
});
