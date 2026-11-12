# 部署步骤（Supabase + Cloudflare Pages）

---

## 1. Supabase 项目

1. 打开 [supabase.com/dashboard](https://supabase.com/dashboard) 新建项目。
2. **Database → Extensions** 确认/启用：
   - `vector`（pgvector）
   - `pg_trgm`
   - `pgcrypto`
3. 打开 **SQL Editor**，执行：
   [supabase/migrations/20261112000000_econ_ai_bank.sql](../supabase/migrations/20261112000000_econ_ai_bank.sql)
4. **Project Settings → Data API**：
   - 确认 `public` schema 已暴露；
   - 确认 `user_set`、`question`、`question_note`、`operation_log` 对 Data API 可见；
   - 2026 年后新 Supabase 项目不再默认自动暴露新表，这一步必须做，否则 PostgREST 返回 404/PGRST205。
5. **Project Settings → API** 记录：
   - Project URL
   - `anon public` key
   - 不要使用 `service_role`

### 验证

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('user_set','question','question_note','operation_log');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'question'
order by indexname;
```

预期：

- 四张表 `rowsecurity = true`；
- 每张表有 token 策略；
- `operation_log` 没有 update/delete 策略；
- `question_embedding_hnsw_idx`、`question_stem_trgm_idx`、`question_tags_gin_idx` 存在。

> 不需要开启 Authentication 的 Email/Phone 或 OAuth。本项目不用 Supabase Auth。

---

## 2. 前端环境变量

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

本地：

```bash
pnpm install
pnpm dev
```

`pnpm dev` 端口 5175；`pnpm build` 输出 `dist/`。

---

## 3. 部署 AI Edge Function

需要安装 Supabase CLI。

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy ai --no-verify-jwt
```

### Chat（分类 / 变式）

任意 OpenAI-compatible 服务：DeepSeek、OpenAI、SiliconFlow、阿里百炼等。

```bash
supabase secrets set \
  AI_CHAT_BASE_URL=https://api.deepseek.com/v1 \
  AI_CHAT_API_KEY=sk-your-chat-key \
  AI_CHAT_MODEL=deepseek-chat
```

### Embedding（相似题）

必须 **1024 维**，因为表是 `vector(1024)`。默认 BGE-M3：

```bash
supabase secrets set \
  AI_EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1 \
  AI_EMBEDDING_API_KEY=sk-your-embedding-key \
  AI_EMBEDDING_MODEL=BAAI/bge-m3
```

可选限制来源：

```bash
supabase secrets set AI_ALLOWED_ORIGIN=https://your-project.pages.dev
```

重新部署使 secrets 生效（通常 secrets 会自动生效，保险起见）：

```bash
supabase functions deploy ai --no-verify-jwt
```

### 没有 AI key 会怎样

- 分类：自动降级为本地关键词规则；
- 向量：自动降级为 1024 维本地 hashed 词法向量；
- 变式：弹窗提示 AI 未配置，功能不可用；
- 其他题库/OCR/批注/草稿/日志全部正常。

### Embedding 维度

如果换成 1536 维（如 `text-embedding-3-small`），需要同时修改：

1. SQL `embedding extensions.vector(1536)`；
2. Edge `EMBEDDING_DIM = 1536`；
3. 本地降级 `localEmbedding(..., 1536)`；
4. 重新建 HNSW 索引。

推荐直接用 1024 维 BGE-M3。

---

## 4. Cloudflare Pages

### 4.1 Git

1. 把项目提交到 GitHub/GitLab；
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git；
3. Production branch：`main`。

### 4.2 构建配置

| 配置 | 值 |
| --- | --- |
| Framework preset | Vite |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Root directory | 仓库根（若仓库根为 `econ-ai-bank/` 则填它） |
| Node version | 20+ |

### 4.3 环境变量

Settings → Environment variables（Production + Preview）：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

修改后必须重新构建；Vite 变量在构建时注入，不是运行时读取。

### 4.4 SPA fallback

已包含 [public/_redirects](../public/_redirects)：

```text
/* /index.html 200
```

Vite 使用 `base: '/'` + History 路由；请部署在域名/Pages 项目**根路径**（Cloudflare Pages 默认）。这样 `/questions/:id` 刷新时 `/assets/*` 仍能正确加载。

### 4.5 自定义域名

绑定后不需要改 Supabase Auth 回调（没有 Auth/邮件）。  
如果未来接入 Supabase Auth，再配置 Site URL。

### 4.6 自托管 Supabase 的 CORS

Supabase Cloud 默认允许 `x-user-token`。自托管时需要在 Kong/Envoy 的 CORS 允许头里加入：

```yaml
headers:
  - Accept
  - Authorization
  - Content-Type
  - apikey
  - x-client-info
  - x-user-token
```

否则浏览器预检会失败。Edge Function 自己的 CORS 已在代码里处理。

---

## 5. 部署后验收

- [ ] 首次打开 `/bank` 自动创建 `user_set`，无登录页。
- [ ] localStorage 出现 `econ_ai_user_token`。
- [ ] 录入一道题，刷新后仍在。
- [ ] 新建第二个浏览器 profile，打开是**空题库**（不同 token）。
- [ ] 在设置页复制迁移密钥，第二个 profile 导入，刷新后看到同一题库。
- [ ] 第一个 profile 修改批注，第二个 profile 刷新后看到。
- [ ] 画布保存后刷新仍在。
- [ ] 相似题只出现当前 token 的题。
- [ ] 变式 1–5 道、难度切换、保存进题库。
- [ ] 操作记录 9 类操作均有；不能删除日志。
- [ ] 换账号 token 后看不到前一个题库。
- [ ] Cloudflare 构建日志无 service_role。

### 数据库抽查

```sql
-- 不应出现重复 token
select user_token, count(*) from user_set group by user_token having count(*) > 1;

-- 题目必须属于 user_set
select count(*) from question q
left join user_set u on u.id = q.user_set_id
where u.id is null;

-- 日志是否有删除权限（应返回 0 行策略）
select * from pg_policies
where schemaname='public' and tablename='operation_log' and cmd in ('DELETE','UPDATE');
```

---

## 6. 备份

- Supabase Dashboard → Database → Backups（付费计划）；
- 或定期用 SQL/CSV 导出；
- 用户也可以在设置页复制迁移密钥，但**密钥不是数据备份**；
- 图片若存 `image_data`，数据库备份会包含；若 text_only 则只有文字。

---

## 7. 排错

| 现象 | 处理 |
| --- | --- |
| 启动显示“缺少 VITE_SUPABASE_URL” | 配 env，重启/重新构建 |
| 启动卡在“正在打开私有题库” | 查 Network 的 `user_set`；是否建表/RLS |
| `PGRST205` / 表不存在 / 404 | 在 Project Settings → Data API 显式暴露 `public` 与四张表 |
| 0 行数据但表有数据 | 检查 `x-user-token` 请求头与 RLS |
| 自托管 CORS 失败 | 网关允许 `x-user-token` |
| 新设备看不到旧题 | 导入迁移密钥；不要只复制 URL |
| 分类总是本地降级 | 检查 Edge 部署与 `AI_CHAT_API_KEY` |
| 相似题为空 | 题目 embedding 是否为空；embedding 维度是否 1024 |
| 变式报 503 | 配置 Chat secrets |
| OCR 卡住 | Tesseract CDN 网络/语言包；可重试 |
| 图片/草稿太大 | 默认 text_only；画布尽量简洁 |
| 清缓存后无法访问 | token 丢失；用迁移密钥 |
