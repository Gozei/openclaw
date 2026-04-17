# 自我进化配置示例

## 基础配置

```json
{
  "enabled": true,
  "testSuite": "critical",
  "autoCommit": true,
  "rollbackOnFailure": true,
  "maxRetryAttempts": 2,
  "notifyOnSuccess": true,
  "qualityThreshold": 85,
  "performanceThreshold": 100
}
```

## Cron 定时任务配置

### 每日进化检查

```bash
openclaw cron add --job '{
  "name": "daily-self-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 3 * * *",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "systemEvent",
    "text": "启动每日自我进化流程"
  },
  "delivery": {
    "mode": "announce"
  }
}'
```

### 每周深度进化

```bash
openclaw cron add --job '{
  "name": "weekly-deep-evolution",
  "schedule": {
    "kind": "cron",
    "expr": "0 2 * * 0",
    "tz": "Asia/Shanghai"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行深度自我进化，使用完整测试套件",
    "timeoutSeconds": 1800
  },
  "delivery": {
    "mode": "announce"
  }
}'
```

### 每小时健康检查

```bash
openclaw cron add --job '{
  "name": "hourly-health-check",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "payload": {
    "kind": "agentTurn",
    "message": "运行快速健康检查（smoke test）"
  }
}'
```

## 使用方式

### 手动触发

```bash
# 标准进化流程
openclaw evolve

# 快速检查
openclaw evolve --test-suite smoke

# 完整测试
openclaw evolve --test-suite full

# 详细输出
openclaw evolve --verbose --json
```

### 查看状态

```bash
# 查看上次运行结果
openclaw evolve status

# 查看历史记录
openclaw evolve history --limit 10
```

### 配置选项

```bash
# 启用自我进化
openclaw evolve configure --enable

# 禁用自我进化
openclaw evolve configure --disable

# 设置测试套件
openclaw evolve configure --test-suite critical

# 设置质量阈值
openclaw evolve configure --quality-threshold 90

# 启用自动提交
openclaw evolve configure --auto-commit

# 禁用自动回滚
openclaw evolve configure --no-auto-rollback
```

## 配置文件位置

- **用户配置**: `~/.openclaw/evolution.config.json`
- **运行历史**: `~/.openclaw/evolution/history.json`
- **上次结果**: `~/.openclaw/evolution/last-run.json`

## 最佳实践

1. **首次运行**: 建议先手动运行一次，观察结果

   ```bash
   openclaw evolve --test-suite smoke --verbose
   ```

2. **生产环境**: 使用 critical 测试套件，启用自动回滚

   ```bash
   openclaw evolve configure --test-suite critical --auto-rollback
   ```

3. **开发环境**: 可以使用 full 测试套件，关闭自动提交

   ```bash
   openclaw evolve configure --test-suite full --no-auto-commit
   ```

4. **监控告警**: 配置失败通知
   ```bash
   openclaw cron add --job '{
     "name": "evolution-failure-alert",
     "schedule": { "kind": "every", "everyMs": 3600000 },
     "payload": {
       "kind": "agentTurn",
       "message": "检查自我进化状态，如有失败发送告警"
     }
   }'
   ```
