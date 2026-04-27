# Git 分支与提交流程规范

本文档定义 OpenClaw 项目的分支命名、提交信息、Pull Request 和发布流程规范。当前项目使用 ClawX 风格的 commit 规范，同时保留 OpenClaw 现有的维护、验证和合并要求。

## 长期分支

- `main` 是生产发布分支，应始终保持可发布状态，不允许创建或推送 merge commit 到 `main`。
- OpenClaw 当前日常开发默认集成到 `main`，除非维护者、发布流程或具体任务明确要求使用其他目标分支。
- 如果后续启用 `develop` 或 staging 分支，日常功能和修复应目标到该分支，发布 PR 再从已验证的 staging 分支合并回 `main`。

## 分支命名

开发分支使用以下格式：

```text
<developer-name>/<type>/<short-description>
```

第一段必须是开发者名字，例如 `tommy`、`gozei`、`jiahe`。不要使用泛化身份或工具名代替开发者名字。

示例：

```text
tommy/docs/git-workflow
gozei/fix/provider-auth-status
jiahe/refactor/plugin-registry
tommy/chore/update-fixtures
```

描述部分使用小写英文单词，并用连字符 `-` 分隔。描述应简短但有明确含义，优先描述业务或技术意图，不建议只使用 ticket 编号。

## 分支类型

- `feat` - 新功能
- `fix` - 问题修复
- `docs` - 文档、说明更新
- `style` - 代码格式或样式调整，不改变预期行为
- `refactor` - 代码重构，不改变预期行为
- `test` - 测试相关改动
- `chore` - 维护、配置、依赖或数据更新
- `build` - 构建系统、打包配置或构建依赖改动
- `ci` - CI/CD 工作流配置改动
- `poc` - 概念验证或实验性改动
- `hotfix` - 线上紧急问题修复

`poc` 分支用于验证方案，不建议直接合并到长期分支。验证通过后，应按实际改动类型整理为 `feat`、`fix`、`refactor` 等正式分支或提交。

## 提交信息与 PR 名称

提交信息和 Pull Request 名称使用 ClawX 风格：

```text
<type>: <short summary>
```

示例：

```text
feat: add provider setup hints
fix: preserve plugin install metadata
docs: update git workflow guidelines
chore: refresh fixture data
refactor: simplify gateway status handling
hotfix: fix release publish guard
```

规则：

- `type` 应与分支类型保持一致，例如 `feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`build`、`ci`、`poc`、`hotfix`。
- `short summary` 使用英文小写开头，简短描述本次改动。
- 优先描述本次改动的语义目的，不要只描述实现细节。
- Pull Request 名称应与 commit message 规范保持一致。
- 如果一个 Pull Request 包含多个 commit，整体 PR 名称应概括该分支的最终目的。

对应关系示例：

```text
分支名：tommy/docs/git-workflow
提交信息：docs: update git workflow guidelines
PR 名称：docs: update git workflow guidelines
```

## 提交流程

使用仓库提交辅助脚本，确保暂存范围可控：

```bash
scripts/committer "<type>: <short summary>" <specific files>
```

不要在日常工作中使用 `git add .` 这类宽泛暂存方式。提交应聚焦同一件事，避免混入无关格式化、清理或重构。

## Pull Request 规则

- 每个分支只处理一个功能、修复或维护任务。
- 每个分支对应一个 Pull Request。
- 请求 review 前应先运行 OpenClaw 要求的相关检查。
- 不要提交密钥、API Key、凭证、真实手机号、视频或本地环境配置文件。
- Pull Request 使用 `.github/pull_request_template.md` 作为规范模板。
- 维护者 landing 或 merge PR 时，遵循 `AGENTS.md` 中引用的 `/landpr` 和 `$openclaw-pr-maintainer` 流程。
- 日常 PR 默认使用 Squash Merge，保持目标分支历史线性整洁。不要创建或推送 merge commit 到 `main`。

## Hotfix 规则

`hotfix` 仅用于处理线上生产环境的紧急问题。

```text
<developer-name>/hotfix/<short-description>
```

示例：

```text
tommy/hotfix/release-publish-guard
gozei/hotfix/gateway-startup-crash
```

`hotfix` 分支应从最新的 `main` 创建，合并前完成最小必要验证，确保线上问题被修复且没有明显回归。如果项目存在活跃 staging 分支，发布后应将修复同步回该分支。

## 推荐工作流

```bash
git checkout main
git pull --rebase origin main
git checkout -b <developer-name>/<type>/<short-description>
```

完成开发后：

```bash
git status
scripts/committer "<type>: <short summary>" <specific files>
git push -u origin <developer-name>/<type>/<short-description>
```

然后创建 Pull Request，PR 名称应匹配提交信息规范。
