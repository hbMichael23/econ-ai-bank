-- ============================================================
-- 经济学考研私有 AI 题库 · Supabase 初始化
--
-- 无账号体系：
--   * 浏览器生成 256-bit user_token（localStorage）
--   * 所有 PostgREST 请求带 x-user-token
--   * RLS 从 request.headers 读取 token
--   * migration_key 通过 security definer RPC 换回 user_token
--
-- 四张核心表：
--   user_set / question / question_note / operation_log
--
-- 注意：
--   * 没有 auth.users 依赖，没有账号、手机号、邮箱、验证码。
--   * 没有定时清理、没有 TTL、没有自动删除。
--   * 题目是软删除（deleted_at），日志不可修改/删除。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------------
-- 1. user_set
-- ------------------------------------------------------------
create table if not exists public.user_set (
  id uuid primary key default extensions.gen_random_uuid(),
  user_token text not null unique
    check (user_token ~ '^ut_[A-Za-z0-9_-]{40,80}$'),
  migration_key text not null unique
    check (migration_key ~ '^mk_[A-Za-z0-9_-]{40,80}$'),
  device_fingerprint text,
  device_label text,
  image_mode text not null default 'text_only'
    check (image_mode in ('text_only', 'cloud')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_set is
  '无账号题库集合：随机 token + 迁移密钥 + 简单设备标识。';
comment on column public.user_set.user_token is
  '浏览器生成的 256-bit 凭证；RLS 通过 x-user-token 请求头匹配。';
comment on column public.user_set.migration_key is
  '换设备迁移密钥；客户端只展示该密钥，不展示 token。';

-- ------------------------------------------------------------
-- 2. question
-- ------------------------------------------------------------
create table if not exists public.question (
  id uuid primary key default extensions.gen_random_uuid(),
  user_set_id uuid not null references public.user_set(id) on delete restrict,
  user_token text not null
    check (user_token ~ '^ut_[A-Za-z0-9_-]{40,80}$'),
  stem text not null check (char_length(btrim(stem)) between 1 and 50000),
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array'),
  answer text not null default '',
  analysis text not null default '',
  auto_tags text[] not null default '{}'::text[],
  manual_tags text[] not null default '{}'::text[],
  tags text[] not null default '{}'::text[],
  subject text not null default '未分类'
    check (subject in ('微观经济学', '宏观经济学', '政治经济学', '未分类')),
  question_type text not null default '未分类'
    check (question_type in ('名词解释', '简答', '计算', '论述', '未分类')),
  difficulty text not null default '未分类'
    check (difficulty in ('基础', '中档', '难题', '未分类')),
  embedding extensions.vector(1024),
  image_data text
    check (image_data is null or char_length(image_data) <= 2000000),
  image_mime text,
  ocr_text text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'photo', 'variant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.question is
  '私有题目；软删除，支持 1000+ 题分页检索。';
comment on column public.question.options is
  'JSON 数组：[{"key":"A","text":"..."}]。';
comment on column public.question.auto_tags is
  'AI 自动生成的知识点标签，可由用户修改。';
comment on column public.question.manual_tags is
  '用户手动标签。';
comment on column public.question.tags is
  '触发器维护的合并标签（auto_tags + manual_tags），用于 GIN 筛选。';
comment on column public.question.embedding is
  '1024 维向量；外部 BGE-M3 或本地 hashed embedding。';
comment on column public.question.image_data is
  '可选：压缩后的原图 data URL；text_only 模式为 null。';

-- ------------------------------------------------------------
-- 3. question_note
--    一道题一行；notes 为多条批注的 JSON 数组，draft_data 为草稿 PNG。
-- ------------------------------------------------------------
create table if not exists public.question_note (
  id uuid primary key default extensions.gen_random_uuid(),
  user_set_id uuid not null references public.user_set(id) on delete restrict,
  user_token text not null
    check (user_token ~ '^ut_[A-Za-z0-9_-]{40,80}$'),
  question_id uuid not null unique references public.question(id) on delete cascade,
  notes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(notes) = 'array'),
  draft_data text,
  draft_mime text not null default 'image/png',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.question_note is
  '题目的附属批注/草稿；notes 支持多条批注，draft_data 保存画布 PNG base64。';
comment on column public.question_note.notes is
  'JSON 数组：[{"id":"...","content":"...","created_at":"...","updated_at":"..."}]。';

-- ------------------------------------------------------------
-- 4. operation_log
--    日志不可更新/删除；question_id 故意不加外键，题目删除后仍保留 ID。
-- ------------------------------------------------------------
create table if not exists public.operation_log (
  id uuid primary key default extensions.gen_random_uuid(),
  user_set_id uuid not null references public.user_set(id) on delete restrict,
  user_token text not null
    check (user_token ~ '^ut_[A-Za-z0-9_-]{40,80}$'),
  operation_type text not null check (operation_type in (
    'photo_upload',
    'create_question',
    'update_question',
    'update_note',
    'edit_draft',
    'update_tags',
    'delete_question',
    'query_similar',
    'generate_variant',
    'view_question',
    'ai_classify',
    'migrate_key',
    'update_settings'
  )),
  question_id uuid,
  operation_time timestamptz not null default now(),
  device_label text,
  detail jsonb not null default '{}'::jsonb
);

comment on table public.operation_log is
  '云端操作审计；只允许 insert/select，不允许 update/delete。';
comment on column public.operation_log.question_id is
  '不设外键：即使题目以后被管理员清理，日志仍保留原题目 ID。';

-- ------------------------------------------------------------
-- updated_at / tags 触发器
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sync_question_tags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.tags := array(
    select distinct tag
    from unnest(
      coalesce(new.auto_tags, '{}'::text[]) || coalesce(new.manual_tags, '{}'::text[])
    ) as tag
    where tag <> ''
    order by tag
  );
  return new;
end;
$$;

drop trigger if exists trg_user_set_touch on public.user_set;
create trigger trg_user_set_touch
before insert or update on public.user_set
for each row execute function public.touch_updated_at();

drop trigger if exists trg_question_tags on public.question;
create trigger trg_question_tags
before insert or update on public.question
for each row execute function public.sync_question_tags();

drop trigger if exists trg_question_note_touch on public.question_note;
create trigger trg_question_note_touch
before insert or update on public.question_note
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 索引：1000+ 题分页、筛选、全文搜索、向量检索
-- ------------------------------------------------------------
create unique index if not exists user_set_token_uidx on public.user_set(user_token);
create unique index if not exists user_set_migration_uidx on public.user_set(migration_key);

create index if not exists question_owner_created_idx
  on public.question(user_token, created_at desc)
  where deleted_at is null;

create index if not exists question_owner_subject_idx
  on public.question(user_token, subject)
  where deleted_at is null;

create index if not exists question_owner_type_idx
  on public.question(user_token, question_type)
  where deleted_at is null;

create index if not exists question_owner_difficulty_idx
  on public.question(user_token, difficulty)
  where deleted_at is null;

create index if not exists question_tags_gin_idx
  on public.question using gin(tags);

create index if not exists question_stem_trgm_idx
  on public.question using gin(stem extensions.gin_trgm_ops);

create index if not exists question_embedding_hnsw_idx
  on public.question using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists question_note_owner_idx
  on public.question_note(user_token, updated_at desc);

create index if not exists operation_log_owner_time_idx
  on public.operation_log(user_token, operation_time desc);

-- ------------------------------------------------------------
-- RLS：从 PostgREST request.headers 读取 x-user-token
-- ------------------------------------------------------------
create or replace function public.request_user_token()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-user-token',
    ''
  );
$$;

comment on function public.request_user_token() is
  '读取 PostgREST 当前请求的 x-user-token；缺失时返回空字符串。';

alter table public.user_set enable row level security;
alter table public.question enable row level security;
alter table public.question_note enable row level security;
alter table public.operation_log enable row level security;

drop policy if exists user_set_select_own on public.user_set;
create policy user_set_select_own on public.user_set
  for select to anon, authenticated
  using (user_token = public.request_user_token());

drop policy if exists user_set_insert_own on public.user_set;
create policy user_set_insert_own on public.user_set
  for insert to anon, authenticated
  with check (user_token = public.request_user_token());

drop policy if exists user_set_update_own on public.user_set;
create policy user_set_update_own on public.user_set
  for update to anon, authenticated
  using (user_token = public.request_user_token())
  with check (user_token = public.request_user_token());

drop policy if exists question_select_own on public.question;
create policy question_select_own on public.question
  for select to anon, authenticated
  using (user_token = public.request_user_token());

drop policy if exists question_insert_own on public.question;
create policy question_insert_own on public.question
  for insert to anon, authenticated
  with check (
    user_token = public.request_user_token()
    and exists (
      select 1 from public.user_set us
      where us.id = user_set_id
        and us.user_token = public.request_user_token()
    )
  );

drop policy if exists question_update_own on public.question;
create policy question_update_own on public.question
  for update to anon, authenticated
  using (user_token = public.request_user_token())
  with check (
    user_token = public.request_user_token()
    and exists (
      select 1 from public.user_set us
      where us.id = user_set_id
        and us.user_token = public.request_user_token()
    )
  );

drop policy if exists question_note_select_own on public.question_note;
create policy question_note_select_own on public.question_note
  for select to anon, authenticated
  using (user_token = public.request_user_token());

drop policy if exists question_note_insert_own on public.question_note;
create policy question_note_insert_own on public.question_note
  for insert to anon, authenticated
  with check (
    user_token = public.request_user_token()
    and exists (
      select 1 from public.question q
      where q.id = question_id
        and q.user_token = public.request_user_token()
    )
  );

drop policy if exists question_note_update_own on public.question_note;
create policy question_note_update_own on public.question_note
  for update to anon, authenticated
  using (user_token = public.request_user_token())
  with check (user_token = public.request_user_token());

drop policy if exists operation_log_select_own on public.operation_log;
create policy operation_log_select_own on public.operation_log
  for select to anon, authenticated
  using (user_token = public.request_user_token());

drop policy if exists operation_log_insert_own on public.operation_log;
create policy operation_log_insert_own on public.operation_log
  for insert to anon, authenticated
  with check (
    user_token = public.request_user_token()
    and exists (
      select 1 from public.user_set us
      where us.id = user_set_id
        and us.user_token = public.request_user_token()
    )
  );

-- 注意：没有 update/delete policy 给 operation_log，日志不可篡改。
-- 注意：question 没有 delete policy；删除由前端写 deleted_at 软删除。
-- 注意：user_set 没有 delete policy；不提供“注销/清空题库”。

-- ------------------------------------------------------------
-- 权限：RLS 之外再限制 SQL 权限
-- ------------------------------------------------------------
revoke all on public.user_set from anon, authenticated;
revoke all on public.question from anon, authenticated;
revoke all on public.question_note from anon, authenticated;
revoke all on public.operation_log from anon, authenticated;

grant select, insert, update on public.user_set to anon, authenticated;
grant select, insert, update on public.question to anon, authenticated;
grant select, insert, update on public.question_note to anon, authenticated;
grant select, insert on public.operation_log to anon, authenticated;

revoke all on function public.request_user_token() from public;
grant execute on function public.request_user_token() to anon, authenticated;

-- ------------------------------------------------------------
-- 迁移密钥兑换
-- ------------------------------------------------------------
create or replace function public.redeem_migration_key(p_key text)
returns table (user_token text)
language sql
security definer
set search_path = public
as $$
  select us.user_token
  from public.user_set us
  where us.migration_key = p_key
  limit 1;
$$;

comment on function public.redeem_migration_key(text) is
  '用迁移密钥换回 user_token；密钥本身是 secret bearer credential。';

revoke all on function public.redeem_migration_key(text) from public;
grant execute on function public.redeem_migration_key(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 相似题检索
-- security invoker：RLS 照常生效，只返回当前 x-user-token 的题目。
-- ------------------------------------------------------------
create or replace function public.match_questions_for_question(
  p_question_id uuid,
  p_limit int default 8
)
returns table (
  id uuid,
  stem text,
  subject text,
  question_type text,
  difficulty text,
  auto_tags text[],
  manual_tags text[],
  similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with target as (
    select q.embedding
    from public.question q
    where q.id = p_question_id
      and q.deleted_at is null
  )
  select
    q.id,
    q.stem,
    q.subject,
    q.question_type,
    q.difficulty,
    q.auto_tags,
    q.manual_tags,
    (1 - (q.embedding <=> target.embedding))::double precision as similarity
  from public.question q
  cross join target
  where q.deleted_at is null
    and q.id <> p_question_id
    and q.embedding is not null
    and target.embedding is not null
  order by q.embedding <=> target.embedding
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

comment on function public.match_questions_for_question(uuid, int) is
  '只在该 token 自己的题库内做 cosine 向量相似检索。';

revoke all on function public.match_questions_for_question(uuid, int) from public;
grant execute on function public.match_questions_for_question(uuid, int) to anon, authenticated;

-- ------------------------------------------------------------
-- 全部知识点标签（用于筛选下拉）
-- ------------------------------------------------------------
create or replace function public.list_question_tags()
returns table (tag text)
language sql
stable
set search_path = public
as $$
  select distinct t.tag
  from public.question q
  cross join lateral unnest(q.tags) as t(tag)
  where q.deleted_at is null
    and t.tag <> ''
  order by t.tag;
$$;

revoke all on function public.list_question_tags() from public;
grant execute on function public.list_question_tags() to anon, authenticated;

-- ============================================================
-- 完成。
-- 下一步：
--   1. 部署 ai Edge Function（分类/向量/变式，模型 key 只放服务端）；
--   2. 前端 .env 配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY；
--   3. Cloudflare Pages 构建 pnpm build，输出 dist。
-- ============================================================
