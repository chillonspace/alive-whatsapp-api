# 开发流程

## 分支策略

- 从已验证的稳定基线创建 `codex/<task-name>`。
- 一个分支只解决一个清晰目标。
- 不在工作分支中混入无关重构或 formatting churn。

## 小步开发

1. 运行 `npm run dev:start` 并填写当日目标。
2. 阅读相关需求和架构说明。
3. 实现一个可独立验证的小阶段。
4. 运行 focused tests 与完整 `npm test`。
5. 更新 docs 与当日日志。
6. 运行 `npm run dev:finish`。
7. 只有当前阶段稳定后才进入下一阶段。

## 验证与回滚

- 修改前记录当前 branch 与 baseline test 状态。
- 接口改动必须记录 request、response、authentication 与 failure behavior。
- 若阶段验证失败，停止扩展范围，记录 blocker，并修复或回退该阶段自己的改动。
- 禁止使用破坏性 Git 操作覆盖其他人的未提交改动。
