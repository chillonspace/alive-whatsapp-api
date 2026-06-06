# 需求与范围

## 项目目标

Alive WhatsApp API 通过 Express 提供 ChakraHQ WhatsApp 消息与 Template API，并使用 Supabase 保存 template metadata 和 API usage data。

## 已有能力

- 发送 session message 与 approved template message。
- 创建、列出和发送带 named variables 的 templates。
- 支持无 header、text header 与 image header。
- 使用 API key、rate limits、daily caps 和 duplicate protection 保护业务 endpoint。
- 通过同一 Express app 支持本地 Node.js 与 Vercel 部署。

## 当前开发需求

验证 Alive 是否可以针对大型 existing WhatsApp Groups / Community Groups：

1. 通过 Chakra / Meta webhook 收到成员 join、leave、request、remove 等群组事件。
2. 通过 Chakra / Meta API 获取指定群组的 participants 或 members，并与预期学生名单比较。

## 明确不在范围内

- 不重建或改变现有 Template API。
- 不建设 frontend、database schema 或 reminder scheduler。
- 不承诺 Chakra / Meta 支持群组事件；必须通过真实环境测试确认。
- 测试 endpoint 不得成为 production membership system。
