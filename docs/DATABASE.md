# 数据库表结构

SQL：[supabase/migrations/20261112000000_econ_ai_bank.sql](../supabase/migrations/20261112000000_econ_ai_bank.sql)

四张核心表，无额外业务表。标签使用 `text[]`，不建 tag 表。

---

## 1. user_set

无账号题库集合。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `user_token` | text unique not null | `ut_` + 32 bytes base64url；RLS 凭证 |
| `migration_key` | text unique not null | `mk_` + 32 bytes base64url；换设备 |
| `device_fingerprint` | text | 轻量设备指纹，仅标识 |
| `device_label` | text | 例如“桌面端 · Chrome” |
| `image_mode` | text | `text_only` / `cloud` |
| `last_seen_at` | timestamptz | 最近连接 |
| `created_at` | timestamptz | 创建 |
| `updated_at` | timestamptz | 触发器维护 |

约束：

```sql
check (user_token ~ '^ut_[A-Za-z0-9_-]{40,80}$')
check (migration_key ~ '^mk_[A-Za-z0-9_-]{40,80}$')
check (image_mode in ('text_only','cloud'))
```

RLS：

- select / insert / update 仅当前 `x-user-token`；
- 没有 delete policy，不提供注销/清空。

---

## 2. question

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_set_id` | uuid fk | → user_set.id，on delete restrict |
| `user_token` | text not null | RLS |
| `stem` | text | 1–50000 字 |
| `options` | jsonb | `[{"key":"A","text":"..."}]` |
| `answer` | text | 参考答案 |
| `analysis` | text | 解析/复盘 |
| `auto_tags` | text[] | AI 标签，可人工改 |
| `manual_tags` | text[] | 手动标签 |
| `tags` | text[] | 触发器维护的合并标签 |
| `subject` | text | 微观/宏观/政治/未分类 |
| `question_type` | text | 名词解释/简答/计算/论述/未分类 |
| `difficulty` | text | 基础/中档/难题/未分类 |
| `embedding` | `extensions.vector(1024)` | 语义向量 |
| `image_data` | text | 可选压缩原图 data URL（≤2,000,000 chars） |
| `image_mime` | text | `image/jpeg` |
| `ocr_text` | text | OCR 原始文本 |
| `source` | text | manual/photo/variant |
| `created_at` | timestamptz | 上传时间 |
| `updated_at` | timestamptz | 触发器 |
| `deleted_at` | timestamptz | 软删除；无自动清理 |

约束：

```sql
check (jsonb_typeof(options) = 'array')
check (subject in (...))
check (question_type in (...))
check (difficulty in (...))
```

索引：

```sql
(user_token, created_at desc) where deleted_at is null
(user_token, subject)
(user_token, question_type)
(user_token, difficulty)
gin(tags)
gin(stem extensions.gin_trgm_ops)
hnsw(embedding extensions.vector_cosine_ops)
```

触发器 `sync_question_tags()`：

- `tags = distinct(auto_tags || manual_tags)`；
- 同时更新 `updated_at`。

RLS：

- select / insert / update 仅当前 token；
- insert/update 还要求 `user_set_id` 属于当前 token；
- **没有 delete policy**，删除由前端写 `deleted_at` 完成。

---

## 3. question_note

一题一行，避免草稿在多条批注中重复。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_set_id` | uuid fk | |
| `user_token` | text | RLS |
| `question_id` | uuid unique fk | → question.id，on delete cascade |
| `notes` | jsonb | 多条批注数组 |
| `draft_data` | text | 画布 PNG base64 / data URL |
| `draft_mime` | text | 默认 image/png |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | 触发器 |

`notes` 元素：

```json
{
  "id": "uuid",
  "content": "文本，可含 $LaTeX$",
  "created_at": "2026-11-12T...",
  "updated_at": "2026-11-12T..."
}
```

为什么不是“一条批注一行”？

- 需求要求每题一个草稿画布；
- 若一条批注一行，草稿会重复或需要额外表；
- 四张表约束下，一题一行 + JSON 数组最直接；
- 个人题库单用户并发很低，整行 upsert 足够。

RLS：select/insert/update 仅当前 token；insert 还要求题目属于当前 token；无 delete policy（批注删除通过更新数组）。

---

## 4. operation_log

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 操作唯一 ID |
| `user_set_id` | uuid fk | |
| `user_token` | text | 绑定用户 token |
| `operation_type` | text | 见下 |
| `question_id` | uuid | 对应题目；**不设外键**，保留历史 ID |
| `operation_time` | timestamptz | 服务端默认 now() |
| `device_label` | text | 简单浏览器标识 |
| `detail` | jsonb | 附加信息 |

operation_type：

```text
photo_upload       拍照上传题目
create_question    新建题目
update_question    修改题干答案
update_note        修改批注
edit_draft         编辑草稿
update_tags        修改标签
delete_question    删除题目
query_similar      查询相似题
generate_variant   AI 生成变式题
view_question      查看题目
ai_classify        AI 自动分类（辅助记录）
migrate_key        迁移题库（预留）
update_settings    修改设置（预留）
```

RLS：

- 仅 select / insert；
- 没有 update / delete policy；
- 应用权限也只 grant select/insert；
- 因此日志不可篡改、不可手动删除。

索引：

```sql
(user_token, operation_time desc)
```

---

## 5. 函数与 RPC

### `request_user_token()`

```sql
select coalesce(
  nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-user-token',
  ''
);
```

### `redeem_migration_key(p_key text)`

- `security definer`；
- 按 `migration_key` 返回 `user_token`；
- 只 grant anon/authenticated；
- 密钥是 bearer secret。

### `match_questions_for_question(p_question_id uuid, p_limit int)`

- `security invoker`，RLS 生效；
- target 向量来自当前题；
- `1 - (q.embedding <=> target.embedding)`；
- limit 1..20；
- 只返回当前 token 的题。

### `list_question_tags()`

- `security invoker`；
- distinct unnest(tags)，排除软删除；
- 只返回当前 token 的标签。

---

## 6. 权限

```sql
revoke all on ... from anon, authenticated;
grant select, insert, update on user_set/question/question_note;
grant select, insert on operation_log;
```

- `anon` role（PostgREST 使用 anon key）是实际调用者；
- `authenticated` 一并授予，但本项目不使用 Supabase Auth；
- 没有 service_role 参与客户端或 Edge AI。

---

## 7. 容量与清理

- 不创建 cron / pg_cron / TTL / 定时删除；
- 题目删除只写 `deleted_at`；
- 批注/草稿随题保留；
- 日志无删除接口；
- `user_set` 无删除接口；
- 1000+ 题依赖分页和索引，不把全部字段/图片拉进列表。
