# 系统架构

## Runtime

- `app.js` 创建共享 Express app。
- `server.js` 用于本地运行。
- `api/index.js` 将同一 app 暴露为 Vercel function。
- `vercel.json` 将所有请求 rewrite 到 `api/index.js`。

## 主要组件

- `routes/` 与 `src/routes/`：HTTP endpoint。
- `services/` 与 `src/services/`：ChakraHQ client、mapping 与 usage logic。
- `src/middleware/auth.js`：`X-API-Key` 验证。
- `src/config/supabase.js`：Supabase service client。
- `src/services/aliveGroupPullReceiptService.js`：记录成功的 Alive Groups customer pull。
- `supabase/schema.sql`：template metadata 与 usage log schema。

## 现有数据流

Client 请求进入 Express route，经 authentication、validation 与 usage protection 后调用 ChakraHQ。Template metadata 与 usage result 写入 Supabase。

## Alive Groups customer pull 数据流

- Customer -> `GET /alive/groups` -> `X-API-Key` authentication。
- Route 读取 `alive_group_exports` 的 `id = latest` row。
- 成功取得 export 后，server-only service 向 `alive_group_pull_receipts` 写入 receipt。
- Receipt insert 使用 one-second timeout 与 best-effort behavior；tracking failure 只写 server log，不改变现有 HTTP 200 response。
- 每次 request 在 insert 前生成固定 UUID，作为未来 insert-level retry 的稳定 identity；客户重新发出的 HTTP request 仍是一次新的 pull。
- Receipt 不保存 API key、IP、手机号、User-Agent 或完整 response JSON。

## 群组检测测试数据流

- Webhook test：Chakra / Meta -> public webhook route -> console log + JSONL test log -> event keyword result。
- Member-list test：authenticated debug route -> Chakra / Meta candidate APIs -> response inspection -> capability report。

Vercel filesystem 不持久；部署环境的 webhook 文件日志只能写入 `/tmp`，console logs 才是主要测试证据。
