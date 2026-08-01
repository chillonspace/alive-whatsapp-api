# Alive Groups Pull Receipts 设计

## 目标

在不改变客户现有 integration 的前提下，持久记录客户成功调用
`GET /alive/groups` 的历史。记录用于回答最后一次拉取时间、累计拉取次数、
指定时段拉取次数，以及客户取得的 export 版本。

客户继续使用现有 URL、HTTP method、`X-API-Key` 与 response JSON；不需要新增
webhook、ACK、header、request field 或其他配合。

## 范围

本阶段只追踪已通过 `X-API-Key` authentication 且 Alive API 已成功取得 latest
export 的请求。Authentication 失败的请求不记为客户 pull。Receipt 只能证明
Alive API 已处理请求并准备返回 HTTP 200，不能证明客户的下游系统已经解析或
处理 JSON。

不修改现有 Template API、Group Monitor export 写入流程或客户 response contract。

## 数据模型

在 Supabase 新增 `alive_group_pull_receipts`：

- `id uuid primary key default gen_random_uuid()`
- `consumer_id text not null`
- `requested_at timestamptz not null default now()`
- `response_status integer not null`
- `exported_at timestamptz`
- `success boolean not null`

第一阶段固定使用 `consumer_id = 'alive_groups_customer'`。不保存 API key、IP、
User-Agent、手机号、完整 response JSON 或其他客户数据。

为常用查询新增 `(consumer_id, requested_at desc)` index。查询累计次数时直接
`count(*)`；查询最后一次时按 `requested_at desc limit 1`；查询客户是否取得某个
版本时按 `exported_at` 过滤。

## 安全边界

该表位于 Supabase `public` schema，但启用 RLS，不为 `anon` 或 `authenticated`
建立 policy，并显式撤销这两个 role 的 table privileges。Alive API 继续使用现有
server-only `SUPABASE_SERVICE_ROLE_KEY` 写入。Service role key 不会进入客户端、
response、docs、tests 或 logs。

## 应用数据流

1. 客户调用 `GET /alive/groups`，携带现有 `X-API-Key`。
2. `requireApiKey` 验证通过。
3. Route 从 `alive_group_exports` 读取 `id = 'latest'`。
4. Route 取得可返回的 response 与 `exported_at`。
5. 独立 receipt service 向 `alive_group_pull_receipts` 插入成功记录。
6. Route 原样返回 HTTP 200 与现有 groups JSON。

Receipt insert 必须被 `await`，避免 Vercel serverless function 在异步写入完成前
结束。它会增加一次很小的 Supabase insert 延迟，但能提供稳定的持久记录。

## 错误处理

Receipt 是 best-effort audit，不是客户 API 的业务依赖：

- Insert 成功：正常返回现有 HTTP 200 response。
- Insert 失败：记录不含敏感数据的 server error，然后仍然返回现有 HTTP 200
  response。
- Latest export 读取失败或不存在：保留现有 500/503 behavior，不写成功 receipt。
- Authentication 失败：保留现有 401 behavior，不写 receipt。

因此 receipt 写入故障不会影响客户取得 groups JSON。极少数 tracking failure
可能造成漏记，并通过 server logs 供排查。

## 查询能力

实现后可从 Supabase 回答：

- 最后一次成功拉取时间。
- 累计成功拉取次数。
- 指定日期或时段的成功拉取次数。
- 每次拉取对应的 `exported_at`。
- 某次 export 更新后，客户是否已经再次拉取。

所有时间以 `timestamptz` 保存；展示时再转换为 `Asia/Kuala_Lumpur`。

## 测试与验证

按 TDD 实现：

1. 先新增 focused tests，验证成功请求写入 receipt，并确认 test 在实现前因缺少
   receipt behavior 而失败。
2. 验证 receipt insert error 不改变 HTTP 200 response。
3. 验证 401、500 与 503 不写成功 receipt。
4. 验证 receipt 不包含 API key、phones 或完整 response。
5. 运行 `node --test test/aliveGroups.test.js`，再运行完整 `npm test`。
6. 在 Supabase 应用 schema 后执行 test insert/query，并确认 RLS/advisor 结果。

## 交付内容

- Supabase schema 更新。
- 隔离的 pull receipt service。
- `GET /alive/groups` 的透明记录接入。
- Focused tests 与完整 regression tests。
- README、architecture 与当日开发日志同步。

