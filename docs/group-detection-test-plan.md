# Chakra 群组检测测试计划

## 成功判断

- Webhook 收到 join / leave 等群组成员事件：Webhook 方案可行。
- API response 包含 participants / members / phone / wa_id：成员列表比较方案可行。
- 两者都无法取得所需数据：大型 existing Group / Community Group 暂不能全自动检测。

## 阶段 A：Webhook Test

- 新增公开 `POST /webhooks/chakra/group-test`。
- 接收任意 JSON，始终返回 `200 OK`。
- 输出 payload 到 console，并写入测试 JSONL。
- 检测约定的 group/member/event keywords。
- 部署后以测试手机执行 join、leave、request 和 remove 等动作。

## 阶段 B：Member-list API Test

- 新增受 `X-API-Key` 保护的 `GET /debug/chakra/group-member-list-test`。
- 使用现有 Chakra Bearer authentication。
- 顺序测试需求指定的四个 candidate endpoint。
- 某个请求失败时继续测试其余 endpoint。
- 检查 member data 与 `TEST_STUDENT_PHONE` 是否存在。

## 阶段 C：结论

- 保存每个 request 的 status 与 response evidence。
- 更新当日开发日志，记录可行性结论与限制。
- 不在此次测试中建设 database、scheduler、frontend 或 production automation。
