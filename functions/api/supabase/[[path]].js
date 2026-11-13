/**
 * Cloudflare Pages Functions 适配器
 * ------------------------------------------------------------------
 * 文件路径（必须精确）：
 *   functions/api/supabase/[[path]].js
 *
 * 它会让 Pages 自动处理：
 *   https://123-cz7.pages.dev/api/supabase/*
 *
 * 不需要在 Workers Routes 里手动加路由。
 *
 * 注意：
 *   - 该文件不在 Vite 的 src/public 中，不会进入前端 dist 包。
 *   - 如果 Pages 构建器不允许 import 到 functions 目录外，
 *     把 worker.js 的全部内容复制到本文件，并将末尾的
 *     `export default { async fetch... }` 改为：
 *
 *     export const onRequest = (context) => proxy(context.request);
 *
 *   - 路径层级：functions/api/supabase -> ../../../worker.js = 项目根/worker.js
 */

import worker from '../../../worker.js';

export const onRequest = (context) => worker.fetch(context.request, context.env, context);
