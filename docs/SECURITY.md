# 安全模型

## 1. 身份与凭证

- 没有账号系统。
- 浏览器生成 32 字节随机 token：`ut_...`，256-bit 熵。
- token 存 localStorage，随每个 Supabase 请求进入 `x-user-token`。
- RLS 用 `request.headers` 读取 token。
- 迁移密钥 `mk_...` 独立生成，用于新设备换回 token。
- 设备指纹只用于设备标识/日志，**不用于授权**。

### 威胁模型

| 威胁 | 防护 | 残余风险 |
| --- | --- | --- |
| 猜 token | 256-bit 随机 | 无 |
| 另一个用户直接查表 | RLS token 匹配 | 拿到 token 即可访问 |
| 迁移密钥泄露 | 高熵 secret | 泄露即访问；无二次验证 |
| XSS 偷 token | DOMPurify + KaTeX trust false + Vue 转义 | 第三方依赖漏洞/浏览器扩展 |
| service_role 泄露 | 前端不使用；构建时拦截 | Supabase 控制台误操作 |
| 自托管 CORS 不放行 | 文档说明 | 请求失败而非泄露 |
| AI prompt 注入 | 题目作为数据；提示忽略指令；输出 JSON 校验收窄 | 模型仍可能输出偏题内容 |
| 外部题库抓取 | Edge 不访问外部题库；相似题只查本库 | 无 |
| 数据库被拖库 | RLS 不防管理员/密钥 | token/migration 明文，需数据库访问控制 |

> token 是 bearer credential：谁拿到 token 就能读写该题库。没有邮箱/手机号可做二次验证，这是无登录设计的必然取舍。

---

## 2. RLS

所有业务表启用 RLS：

```sql
using (user_token = public.request_user_token())
```

- `request_user_token()` 只读当前请求头，缺省返回 `''`；
- 无 token 时所有行不匹配；
- insert/update 的 `with check` 同样校验；
- 题目插入还要求 `user_set_id` 属于当前 token；
- 批注插入要求题目属于当前 token；
- 日志插入要求 user_set 属于当前 token。

没有给 `operation_log` update/delete 策略；SQL 权限也只 grant select/insert。  
没有给 `question` delete 策略；删除是软删除。  
没有给 `user_set` delete 策略。

---

## 3. 迁移密钥

- `redeem_migration_key` 是 `security definer`，绕过 RLS 按 key 查找；
- 只 grant execute 给 anon/authenticated；
- 返回 user_token，前端写入 localStorage；
- key 高熵，但一旦泄露，攻击者可直接接管题库；
- UI 有明确警告：不要公开、不要截图分享；
- 没有过期时间（需求不要求，且不应自动失效导致用户丢题库）。
- 遗失 key 且清空 localStorage = 无法找回。

---

## 4. AI Edge Function

- 前端不持有模型 key；
- Edge secrets 保存 Chat/Embedding key；
- 函数先验证 `x-user-token`：用 anon key + 自定义头查询 `user_set`，受 RLS 保护；
- 不需要 service_role；
- 函数不读取题目表，只把用户主动提交的文本发给模型；
- 不联网抓题、不接受外部 URL；
- CORS 明确允许 `x-user-token`；
- 错误信息不包含密钥；
- `verify_jwt=false`，因此函数自身必须做 token 校验（已做）。

---

## 5. 前端 XSS

- 用户文本用 Vue 插值/属性绑定，自动转义；
- Markdown/LaTeX 使用 `marked` → `DOMPurify` → `v-html`；
- KaTeX `trust: false`、`throwOnError: false`；
- 图片由 Canvas 重编码为 JPEG，避免上传任意 SVG/HTML；
- 操作日志 detail 通过 Vue 文本渲染；
- AI 返回内容同样经过 MathText 清洗。

---

## 6. 数据最小化

- 不收集邮箱、手机号、姓名、位置、通讯录；
- 设备标识只有浏览器 UA 简单标签 + 本地计算的短指纹；
- 不接第三方统计/广告；
- 没有分享/公开链接；
- 操作日志不含 IP、精确设备型号。

---

## 7. 禁止事项核对

- [x] 无账号登录
- [x] 无手机号 / 邮箱 / 验证码
- [x] 不同 token 数据隔离
- [x] 无自动清理题目/批注/草稿/日志
- [x] 无社交/评论/分享/排行榜
- [x] 无付费/强制限流 UI
- [x] 无外部题库抓取；相似检索仅本库
- [x] 无 service_role 进入前端

---

## 8. 上线建议

1. Supabase 项目开启 2FA，限制组织成员。
2. 不要在前端/Cloudflare env 放 service_role。
3. 定期轮换 AI key；AI key 只在 Edge secrets。
4. 为 Cloudflare Pages 配 HTTPS 和自定义域名。
5. 自托管 Supabase 时锁定 CORS 来源到 Pages 域名。
6. 迁移密钥只通过可信渠道传递。
7. 定期数据库备份；token 丢失无法靠邮箱找回。
8. 关注 Tesseract/KaTeX/Vue 依赖安全更新。
