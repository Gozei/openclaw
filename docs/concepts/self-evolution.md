# 自我进化 (Self-Evolution)

OpenClaw 的自我进化能力让系统能够自动测试、优化和改进自身。

## 核心功能

### 1. 自动化测试 🧪

- **Smoke Test**: 快速健全检查 (~1 分钟)
- **Critical Test**: 核心功能测试 (~5 分钟)
- **Full Test**: 完整测试套件 (~20 分钟)

### 2. 代码质量分析 📊

- ESLint 规则检查
- 循环依赖检测
- 代码复杂度分析
- 质量评分 (0-100)

### 3. 性能监控 ⚡

- 内存使用检测
- 磁盘空间监控
- 响应时间测量
- 瓶颈识别

### 4. 自动优化 💡

- 自动提交改进
- 失败自动回滚
- 优化建议生成

## 快速开始

### 首次运行

```bash
# 快速检查
openclaw evolve --test-suite smoke

# 标准流程
openclaw evolve

# 详细输出
openclaw evolve --verbose
```

### 配置定时任务

```bash
# 每日凌晨 3 点自动进化
openclaw cron add --job '{
  "name": "daily-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 3 * * *"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行每日自我进化"
  }
}'
```

## 工作流程

```
┌─────────────────────────────────────────────────────────┐
│                   自我进化流程                           │
├─────────────────────────────────────────────────────────┤
│  1. 运行测试套件                                         │
│     └─→ 失败？→ 回滚 → 结束                              │
│                                                         │
│  2. 代码质量分析                                         │
│     └─→ 得分 < 阈值？→ 生成优化建议                      │
│                                                         │
│  3. 性能检查                                             │
│     └─→ 发现瓶颈？→ 生成优化建议                         │
│                                                         │
│  4. 提交优化                                             │
│     └─→ 有建议？→ Git 提交 → 通知                        │
│                                                         │
│  5. 生成报告                                             │
│     └─→ 保存历史 → 更新状态                              │
└─────────────────────────────────────────────────────────┘
```

## 配置选项

| 选项                   | 默认值     | 说明             |
| ---------------------- | ---------- | ---------------- |
| `enabled`              | `true`     | 是否启用自我进化 |
| `testSuite`            | `critical` | 测试套件类型     |
| `autoCommit`           | `true`     | 自动提交优化     |
| `rollbackOnFailure`    | `true`     | 失败自动回滚     |
| `maxRetryAttempts`     | `2`        | 最大重试次数     |
| `qualityThreshold`     | `85`       | 质量得分阈值     |
| `performanceThreshold` | `100`      | 性能阈值 (ms)    |

## 命令参考

### evolve

```bash
openclaw evolve [options]

选项:
  --config <path>              配置文件路径
  --test-suite <type>          测试套件 (smoke|critical|full)
  --no-commit                  禁用自动提交
  --no-rollback                禁用自动回滚
  --verbose                    详细输出
  --json                       JSON 格式输出
```

### evolve status

```bash
openclaw evolve status [options]

选项:
  --json                       JSON 格式输出
```

### evolve configure

```bash
openclaw evolve configure [options]

选项:
  --enable                     启用自我进化
  --disable                    禁用自我进化
  --test-suite <type>          默认测试套件
  --quality-threshold <num>    质量阈值 (0-100)
  --auto-commit                启用自动提交
  --no-auto-commit             禁用自动提交
  --auto-rollback              启用自动回滚
  --no-auto-rollback           禁用自动回滚
```

### evolve history

```bash
openclaw evolve history [options]

选项:
  --limit <num>                显示条目数 (默认：10)
  --json                       JSON 格式输出
```

## 输出示例

### 成功

```
🧬 启动自我进化流程...
   工作目录：/path/to/workspace
   测试套件：critical

📋 步骤 1/4: 运行自动化测试...
✅ 测试通过：156/156

📊 步骤 2/4: 代码质量检查...
   质量得分：92/100

⚡ 步骤 3/4: 性能检查...
   性能得分：95/100

💾 步骤 4/4: 提交优化...
   已提交：a1b2c3d

✅ 自我进化完成！耗时：3420ms

📬 进化报告:
   状态：success
   耗时：3420ms
   测试：156/156 通过
   质量：92/100
   性能：95/100
   提交：a1b2c3d
```

### 失败

```
🧬 启动自我进化流程...

📋 步骤 1/4: 运行自动化测试...
❌ 测试失败：3/156

🔄 执行回滚...
   已回滚到：e5f6g7h

❌ 自我进化失败：测试失败，已回滚到上一个稳定版本
```

## 最佳实践

1. **首次部署**: 先手动运行，确认配置正确
2. **生产环境**: 使用 `critical` 测试套件，启用自动回滚
3. **开发环境**: 可使用 `full` 测试套件，关闭自动提交
4. **监控告警**: 配置失败通知，及时发现问题

## 故障排查

### 测试失败

```bash
# 查看详细错误
openclaw evolve --test-suite smoke --verbose

# 手动运行测试
pnpm test --run
```

### 质量得分低

```bash
# 运行 ESLint
pnpm exec eslint src/ --format=pretty

# 修复自动修复的问题
pnpm exec eslint src/ --fix
```

### 性能问题

```bash
# 检查内存使用
node -e "console.log(process.memoryUsage())"

# 检查磁盘使用
du -sh ~/.openclaw/*
```

## 相关文件

- 核心实现：`src/infra/self-evolution.ts`
- CLI 命令：`src/cli/evolution-cli.ts`
- 配置示例：`docs/concepts/self-evolution-config.md`

## 参见

- [定时任务](/automation/cron-jobs)
- [测试与质量保障](/help/testing)
- [提示缓存与性能](/reference/prompt-caching)
