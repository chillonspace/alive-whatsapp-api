# 工程标准

## 安全

- credentials、tokens、service role keys 只能通过 environment variables 提供。
- 不在代码、docs、tests 或 dev logs 中保存真实 secrets、完整手机号或真实 webhook payload。
- Debug endpoint 默认使用现有 `X-API-Key` 保护；外部 webhook 仅在提供方无法携带该 header 时公开。

## 代码与范围

- 遵循现有 Node.js、Express、CommonJS 与 `node:test` 模式。
- 优先新增隔离的 route/service，不改变现有 Template API。
- 每个 change 应保持小范围、可测试、可回滚。
- 错误响应不得暴露 credentials；上游测试失败应保留足够的 status 与 body 供判断。

## Logging

- Production evidence 优先使用 platform console logs。
- JSONL test logs 每行必须是独立 JSON，并包含 timestamp。
- Vercel 只允许将临时测试文件写入 `/tmp`。
- 日志不得保存敏感值；需要识别号码时仅记录匹配结果或 masked value。

## Testing

- 新 helper 必须包含 focused unit tests。
- 每个阶段先运行相关 tests，再运行完整 `npm test`。
- 测试失败不得被忽略；开发日志必须记录失败状态与待处理项。
