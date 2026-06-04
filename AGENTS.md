# Agent 工作指引

本文件是仓库内唯一的 Agent 工作指引。不要创建 `AGENT.md`、`CLAUDE.md` 或其他重复规则文件；所有 Agent 规则统一维护在此处。

## 开工前

1. 阅读 `docs/README.md`，再阅读与任务相关的 requirements、architecture 和执行计划。
2. 查看当前日期对应的 `dev-logs/YYYY-MM-DD.md`；没有时运行 `npm run dev:start`。
3. 确认 Git 状态和当前分支。新功能必须使用独立的 `codex/` 分支。
4. 将工作拆成可单独验证的小阶段，每次只推进一个阶段。

## 开发要求

- 中文为主要说明语言，保留准确的 English technical terms、路径、命令和 API 名称。
- 遵循 `docs/engineering-standards.md` 与 `docs/development-workflow.md`。
- 修改前确认范围；不进行无关重构。
- 未经明确要求，不修改现有 Template API 的行为或接口。
- 不提交 credentials、API token、完整手机号、真实 webhook payload 或其他敏感信息。
- 每个阶段完成后运行相关测试，再运行完整 `npm test`。

## 收尾要求

1. 更新当日日志中的已完成事项、技术决定、修改文件、风险与待办。
2. 运行 `npm run dev:finish`，记录 Git snapshot 和测试结果。
3. 确认相关 docs 已同步，且下一阶段可以从日志中的待办直接开始。
