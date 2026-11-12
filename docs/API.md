# 接口设计

所有 Supabase Data API 请求：

```http
apikey: <VITE_SUPABASE_ANON_KEY>
Authorization: Bearer <VITE_SUPABASE_ANON_KEY>
x-user-token: ut_...
```

`x-user-token` 是唯一业务身份。前端由 `src/lib/supabase.js` 自动注入。

---

## 1. 表接口（PostgREST）

### 1.1 创建/读取当前题库集合

首次启动：

```http
GET /rest/v1/user_set?select=*&user_token=eq.ut_xxx
Accept: application/vnd.pgrst.object+json
```

没有则：

```http
POST /rest/v1/user_set
Content-Type: application/json

{
  "user_token": "ut_xxx",
  "migration_key": "mk_xxx",
  "device_fingerprint": "hex...",
  "device_label": "桌面端 · Chrome",
  "image_mode": "text_only"
}
```

设备信息/最近连接：

```http
PATCH /rest/v1/user_set?id=eq.<uuid>
```

### 1.2 题目列表

```http
GET /rest/v1/question
  ?select=id,stem,options,answer,subject,question_type,difficulty,auto_tags,manual_tags,tags,created_at,source,image_mime
  &user_token=eq.ut_xxx
  &deleted_at=is.null
  &order=created_at.desc
  &offset=0&limit=12
Prefer: count=exact
```

筛选：

| 参数 | 示例 |
| --- | --- |
| 学科 | `subject=eq.微观经济学` |
| 题型 | `question_type=eq.计算` |
| 难度 | `difficulty=eq.中档` |
| 标签 | `tags=cs.{效用函数}` |
| 题干关键词 | `stem=ilike.%索洛%` |

响应数组；`Content-Range: 0-11/137` 提供总数。

### 1.3 题目详情

```http
GET /rest/v1/question
  ?select=*
  &id=eq.<uuid>
  &user_token=eq.ut_xxx
  &deleted_at=is.null
Accept: application/vnd.pgrst.object+json
```

### 1.4 新建/修改/软删除

```http
POST /rest/v1/question
```

```json
{
  "user_set_id": "<uuid>",
  "user_token": "ut_xxx",
  "stem": "已知...",
  "options": [{"key":"A","text":"..."}],
  "answer": "...",
  "analysis": "...",
  "subject": "微观经济学",
  "question_type": "计算",
  "difficulty": "中档",
  "auto_tags": ["效用函数"],
  "manual_tags": ["易错"],
  "embedding": [0.12, -0.03, "... 1024 维"],
  "image_data": null,
  "image_mime": null,
  "ocr_text": "...",
  "source": "photo"
}
```

修改：

```http
PATCH /rest/v1/question?id=eq.<uuid>&user_token=eq.ut_xxx
```

软删除：

```http
PATCH /rest/v1/question?id=eq.<uuid>
{
  "deleted_at": "2026-11-12T...",
  "updated_at": "2026-11-12T..."
}
```

批量：`.in('id', ids)` 发一次 PATCH。

### 1.5 批注/草稿

读取：

```http
GET /rest/v1/question_note
  ?select=*
  &question_id=eq.<uuid>
  &user_token=eq.ut_xxx
```

保存（有则更新，无则插入）：

```http
POST /rest/v1/question_note?on_conflict=question_id
Prefer: resolution=merge-duplicates,return=representation

{
  "question_id": "<uuid>",
  "user_set_id": "<uuid>",
  "user_token": "ut_xxx",
  "notes": [
    {
      "id": "uuid",
      "content": "踩坑...",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "draft_data": "data:image/png;base64,...",
  "draft_mime": "image/png"
}
```

### 1.6 操作日志

```http
POST /rest/v1/operation_log
{
  "user_set_id": "<uuid>",
  "user_token": "ut_xxx",
  "operation_type": "photo_upload",
  "question_id": "<uuid>",
  "device_label": "移动端 · Safari",
  "detail": {
    "subject": "微观经济学",
    "tags": ["效用函数"],
    "has_image": false
  }
}
```

读取：

```http
GET /rest/v1/operation_log
  ?select=*
  &user_token=eq.ut_xxx
  &order=operation_time.desc
  &offset=0&limit=30
Prefer: count=exact
```

没有 update/delete API 权限。

---

## 2. RPC

### 2.1 迁移密钥

```http
POST /rest/v1/rpc/redeem_migration_key
{
  "p_key": "mk_xxx"
}
```

返回：

```json
[
  { "user_token": "ut_xxx" }
]
```

失败返回 `[]`。前端写入 localStorage 并刷新。

### 2.2 相似题

```http
POST /rest/v1/rpc/match_questions_for_question
{
  "p_question_id": "<uuid>",
  "p_limit": 8
}
```

返回：

```json
[
  {
    "id": "uuid",
    "stem": "...",
    "subject": "微观经济学",
    "question_type": "计算",
    "difficulty": "中档",
    "auto_tags": ["效用函数"],
    "manual_tags": [],
    "similarity": 0.873
  }
]
```

`similarity = 1 - cosine_distance`。函数 security invoker，RLS 只返回当前 token 的题。

### 2.3 标签列表

```http
POST /rest/v1/rpc/list_question_tags
{}
```

```json
[{ "tag": "IS-LM" }, { "tag": "效用函数" }]
```

---

## 3. Edge Function `ai`

```http
POST https://<project>.supabase.co/functions/v1/ai
apikey: <anon>
Authorization: Bearer <anon>
x-user-token: ut_...
Content-Type: application/json
```

### 3.1 分类

```json
{
  "action": "classify",
  "payload": {
    "stem": "...",
    "options": [{"key":"A","text":"..."}],
    "answer": "...",
    "analysis": "..."
  }
}
```

```json
{
  "data": {
    "subject": "微观经济学",
    "question_type": "计算",
    "difficulty": "中档",
    "knowledge_tags": ["效用函数", "消费者均衡"]
  },
  "model": "deepseek-chat"
}
```

### 3.2 Embedding

```json
{
  "action": "embed",
  "payload": {
    "text": "学科：... 题目：..."
  }
}
```

```json
{
  "embedding": [0.01, -0.02, "... 1024 维"],
  "model": "BAAI/bge-m3",
  "dimensions": 1024
}
```

### 3.3 变式

```json
{
  "action": "variants",
  "payload": {
    "stem": "...",
    "options": [],
    "answer": "...",
    "analysis": "...",
    "subject": "微观经济学",
    "question_type": "计算",
    "difficulty": "中档",
    "tags": ["效用函数"],
    "count": 3,
    "difficultyMode": "same"
  }
}
```

`difficultyMode`: `easier | same | harder`。

```json
{
  "variants": [
    {
      "stem": "...",
      "options": [{"key":"A","text":"..."}],
      "answer": "...",
      "analysis": "...",
      "subject": "微观经济学",
      "question_type": "计算",
      "difficulty": "中档",
      "knowledge_tags": ["效用函数"]
    }
  ],
  "model": "deepseek-chat"
}
```

错误：

```json
{
  "error": "AI Chat 尚未配置...",
  "code": "ai_not_configured"
}
```

HTTP 401 token 无效，503 未配置，502 上游失败。

---

## 4. 前端 service 映射

`src/lib/questions.js`：

| 函数 | 接口 |
| --- | --- |
| `listQuestions` | GET question（count + range + filters） |
| `getQuestion` | GET question by id |
| `createQuestion` | POST question |
| `updateQuestion` | PATCH question |
| `softDeleteQuestions` | PATCH deleted_at |
| `logOperation` | POST operation_log |
| `listQuestionTags` | RPC list_question_tags |
| `findSimilarQuestions` | RPC match_questions_for_question |
| `getNoteRow` | GET question_note |
| `saveNoteRow` | POST question_note on_conflict |
| `listLogs` | GET operation_log |

`src/lib/ai.js`：`analyzeQuestion`、`embedQuestion`、`generateVariants`。

---

## 5. 错误约定

| HTTP/code | 前端展示 |
| --- | --- |
| 401 `unauthorized` | 设备 token 失效；刷新/迁移 |
| 503 `ai_not_configured` | AI 未配置，分类/向量本地降级；变式提示配置 |
| 429 `ai_upstream_rate_limit` | 模型繁忙，稍后再试 |
| 502 `ai_upstream_error` | 模型调用失败 |
| `embedding_dim_mismatch` | 换 1024 维 embedding 模型 |
| PGRST116 | maybeSingle 无行；转 null（非错误） |
| RLS 0 行 | 不属于当前 token 或已被删除 |

前端不展示模型 key、不写 service_role。
