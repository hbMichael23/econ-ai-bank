# 整体架构说明

## 1. 目标与约束

- 面向经济学考研的**私有**题库，不做社交/公开分享。
- 无账号密码、手机号、邮箱、验证码。
- 云端持久化，多端浏览器看到同一套题库。
- 本地不存题目正文；localStorage 只保存 token 与主题。
- 不自动清理题目/批注/草稿/日志。
- 1000+ 题仍可稳定分页、检索。

---

## 2. 运行拓扑

```text
Browser (Cloudflare Pages)
  ├─ Vue 3 SPA
  ├─ Tesseract.js（浏览器 OCR）
  ├─ KaTeX（公式）
  ├─ localStorage: econ_ai_user_token / econ_ai_theme
  │
  ├─ Supabase PostgREST
  │    ├─ user_set
  │    ├─ question
  │    ├─ question_note
  │    ├─ operation_log
  │    ├─ RPC redeem_migration_key
  │    ├─ RPC match_questions_for_question
  │    └─ RPC list_question_tags
  │
  └─ Supabase Edge Function `ai`
       ├─ 验证 x-user-token（仅 RLS 查询 user_set）
       ├─ Chat Completions → 分类 / 变式
       └─ Embeddings → 1024 维向量
```

没有 Node 业务服务器；所有持久化在 Supabase。

---

## 3. 无账号身份模型

### 3.1 首次访问

1. 读取 `localStorage.econ_ai_user_token`。
2. 不存在则生成：

```js
ut_ + base64url(crypto.getRandomValues(32 bytes))
```

3. `setUserToken(token)` 后，所有 Supabase 请求都带 `x-user-token`。
4. 查询 `user_set`；没有则插入一行，并生成 `mk_...` 迁移密钥。
5. 生成轻量设备指纹（UA/语言/时区/屏幕/CPU/触屏等哈希），写入 `user_set` 作为**设备标识**，同时写入 `operation_log.device_label` 的简单浏览器名。
6. 进入 `/bank`。

### 3.2 为什么不能只用设备指纹

设备指纹会因浏览器升级、分辨率、隐私设置而变化，也可能碰撞。  
若用指纹直接认领题库，两个用户可能互相看到数据。因此：

- **随机 256-bit token 才是凭证**；
- 指纹只用于设备信息和日志；
- 换设备靠迁移密钥。

### 3.3 迁移

```text
设备 A（已有题库）
  Settings → 显示 mk_xxx
        │
        │ 用户复制到设备 B
        ▼
设备 B（自动生成了自己的空 token）
  Settings → 粘贴 mk_xxx
        │
        ▼
  RPC redeem_migration_key(mk_xxx)
        │  security definer，仅按 key 查询
        ▼
  返回 user_token
        │
        ▼
  写入 B 的 localStorage → 刷新 → 同一套题库
```

新设备第一次访问会自动创建一个空 `user_set`；导入迁移密钥后切换到旧 token，空集合不会被使用。  
没有自动删除旧空集合，符合“禁止自动清理”的原则；如需清理可手动由管理员执行。

---

## 4. RLS 请求头隔离

Supabase 的 PostgREST 会把当前请求头写入 `request.headers` GUC。  
SQL 中：

```sql
create function public.request_user_token()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-user-token',
    ''
  );
$$;
```

每张表都有 `user_token` 列，策略：

```sql
using (user_token = public.request_user_token())
```

因此：

- 不带 `x-user-token`：查询返回 0 行；
- 带 A token：只能读写 A 行；
- 带 B token：看不到 A 数据；
- 前端使用 anon key，RLS 仍然生效；
- 迁移 RPC 是 `security definer`，只有持有 `mk_` 的人能换回 token。

> 注意：Supabase Cloud 默认允许自定义请求头；自托管需在网关 CORS 允许 `x-user-token`。

---

## 5. 数据流

### 5.1 录入

```text
拍照/文件
  → Canvas 压缩 JPEG（≤1.8MB data URL）
  → Tesseract chi_sim+eng
  → parseOcrText（题干 + A/B/C/D）
  → AI classify（失败则本地关键词）
  → 用户校对
  → AI embedding（失败则本地 hashed 1024）
  → insert question
  → log photo_upload / create_question / ai_classify
```

保存原图开关：

- 关：`image_data = null`，只保留 OCR 文本；
- 开：压缩 data URL 写入 `question.image_data`，随 RLS 保存；
- 全局默认在 `user_set.image_mode`，单题可覆盖。

### 5.2 批注与草稿

- `question_note` 一题一行：
  - `notes jsonb`：多条批注数组（满足“一题多批注”）；
  - `draft_data text`：画布 PNG base64；
  - `draft_mime`。
- 新增/编辑/删除批注都会 upsert 同一行并写 `operation_log(update_note)`。
- 画布自动保存 1.3s 防抖；也提供手动保存；写 `operation_log(edit_draft)`。
- 同一题在多端刷新后读取同一行。

### 5.3 相似题

```text
当前 question.id
  → RPC match_questions_for_question
  → target.embedding
  → q.embedding <=> target.embedding
  → 1 - distance as similarity
  → ORDER BY distance
  → LIMIT 8
```

- 函数是 `security invoker`，RLS 继续生效，只可能返回当前 token 的题；
- 不访问外部题库；
- 无向量时返回空，界面提示重新保存生成向量。

### 5.4 变式

- 前端把原题发给 Edge `ai`，附 count + difficultyMode；
- Edge 验证 token 后调用 Chat，返回结构化 JSON；
- 前端只预览，用户逐题保存；
- 保存时重新生成 embedding，并写 `question.source = 'variant'`；
- AI 调用成功/失败都写 `generate_variant` 日志。

---

## 6. 前端结构

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 入口 | `src/main.js` | 初始化 token/store/router，再 mount |
| 路由 | `src/router/index.js` | 6 个页面 |
| 用户 | `src/stores/user.js` | token、user_set、迁移、主题、原图策略 |
| Supabase | `src/lib/supabase.js` | anon client + 动态 `x-user-token` |
| 表 API | `src/lib/questions.js` | 列表/详情/增改/软删/日志/批注/相似 |
| AI | `src/lib/ai.js` | Edge 调用 + 本地降级 |
| OCR | `src/lib/ocr.js` | 压缩、Tesseract、选项解析 |
| 本地 AI | `src/lib/local-ai.js` | 关键词分类 + 1024 hashed 向量 |
| 画布 | `src/components/DraftCanvas.vue` | 触屏/鼠标绘制、撤销、自动保存 |
| 公式 | `src/components/MathText.vue` | marked + DOMPurify + KaTeX |

没有题目数据缓存。刷新页面重新请求云端，因此：

- 清 localStorage 不会永久丢题（只要 token/迁移密钥还在）；
- 清站点数据会丢 token，需要迁移密钥恢复。

---

## 7. 关键取舍

| 决策 | 原因 | 代价 |
| --- | --- | --- |
| 不用 Supabase Auth | 硬性要求免登录 | token 是 bearer secret，泄露即访问 |
| 自定义 header + RLS | 不引入业务服务器，仍能隔离 | 自托管需配置 CORS 允许该头 |
| 迁移密钥与 token 分离 | 不把主 token 直接发给新设备 | 多一个 RPC 和密钥管理 |
| 图片 base64 入库 | 无需 Storage RLS/签名 URL，token 模型统一 | 大量原图占用 DB；默认 text_only |
| 批注 JSONB 一题一行 | 满足多条批注 + 单草稿，不增加第五张表 | 批注并发写是整行覆盖，适合个人单用户 |
| 无 Realtime | 需求只要求刷新互通 | 不做实时推送 |
| 软删除 | 可追溯、绝不自动清理 | 数据库保留 deleted_at 行 |
| AI 本地降级 | 没有 key 也能分类/相似题 | 本地向量是词法近似，不是真语义 |

---

## 8. 1000+ 题

- 列表只 select 卡片字段（无 image_data/draft/embedding）；
- 默认 12/页、服务端 range；
- `count: exact` 分页总数；
- `(user_token, created_at desc)`、学科/题型/难度、tags GIN、stem trigram GIN、HNSW；
- 详情才取图片与正文；
- 批量删除当前页，最多 50 条/请求；
- 操作日志 30/页。
