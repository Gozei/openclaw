# 🧬 自我进化定时任务配置

## 推荐配置

### 1. 每日进化检查（凌晨 3 点）

```bash
node scripts/run-node.mjs cron add --job '{
  "name": "daily-self-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 3 * * *",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行每日自我进化流程，使用 smoke 测试套件",
    "timeoutSeconds": 600
  },
  "delivery": {
    "mode": "announce"
  }
}'
```

### 2. 每周深度进化（周日凌晨 2 点）

```bash
node scripts/run-node.mjs cron add --job '{
  "name": "weekly-deep-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 2 * * 0",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行深度自我进化，使用 full 测试套件，生成详细报告",
    "timeoutSeconds": 1800
  },
  "delivery": {
    "mode": "announce"
  }
}'
```

### 3. 每小时健康检查

```bash
node scripts/run-node.mjs cron add --job '{
  "name": "hourly-health-check",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行快速健康检查，报告系统状态",
    "timeoutSeconds": 300
  }
}'
```

### 4. 进化失败告警

```bash
node scripts/run-node.mjs cron add --job '{
  "name": "evolution-failure-alert",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "payload": {
    "kind": "agentTurn",
    "message": "检查自我进化状态，如有失败发送告警通知",
    "timeoutSeconds": 120
  }
}'
```

## 执行命令

运行以下命令应用配置：

```bash
cd ~/Desktop/deepclaw/openclaw

# 每日进化
node scripts/run-node.mjs cron add --job '{
  "name": "daily-self-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 3 * * *",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行每日自我进化流程，使用 smoke 测试套件",
    "timeoutSeconds": 600
  },
  "delivery": {
    "mode": "announce"
  }
}'

# 每周深度进化
node scripts/run-node.mjs cron add --job '{
  "name": "weekly-deep-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 2 * * 0",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行深度自我进化，使用 full 测试套件，生成详细报告",
    "timeoutSeconds": 1800
  },
  "delivery": {
    "mode": "announce"
  }
}'

# 每小时健康检查
node scripts/run-node.mjs cron add --job '{
  "name": "hourly-health-check",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行快速健康检查，报告系统状态",
    "timeoutSeconds": 300
  }
}'
```

## 查看定时任务

```bash
# 列出所有任务
node scripts/run-node.mjs cron list

# 查看特定任务
node scripts/run-node.mjs cron list --include-disabled

# 运行历史
node scripts/run-node.mjs cron runs --jobId <job-id>
```

## 管理任务

```bash
# 禁用任务
node scripts/run-node.mjs cron update --jobId <job-id> --patch '{"enabled": false}'

# 启用任务
node scripts/run-node.mjs cron update --jobId <job-id> --patch '{"enabled": true}'

# 删除任务
node scripts/run-node.mjs cron remove --jobId <job-id>

# 立即运行任务
node scripts/run-node.mjs cron run --jobId <job-id>
```

## 监控建议

1. **每日检查**: 查看 `openclaw evolve status` 确认昨日进化成功
2. **每周审查**: 查看 `openclaw evolve history --limit 7` 审查一周进化记录
3. **质量趋势**: 关注质量得分变化，如持续下降需人工介入
4. **性能监控**: 注意性能瓶颈报告，及时优化

## 告警条件

当出现以下情况时，系统应发送告警：

- ❌ 测试失败率 > 10%
- ❌ 质量得分 < 80
- ❌ 性能得分 < 70
- ❌ 连续 3 次进化失败
- ❌ 内存使用 > 1GB
- ❌ 磁盘使用 > 10GB

## 配置文件

定时任务配置保存在：

- `~/.openclaw/state/cron-jobs.json`

进化历史保存在：

- `~/.openclaw/evolution/history.json`
- `~/.openclaw/evolution/last-run.json`
