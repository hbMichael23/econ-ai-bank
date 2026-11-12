import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';

function isServiceRoleKey(key) {
  if (!key) return false;
  if (String(key).startsWith('sb_secret_')) return true;
  const parts = String(key).split('.');
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const anonKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (isServiceRoleKey(anonKey)) {
    throw new Error(
      '[经济学 AI 题库] VITE_SUPABASE_ANON_KEY 是 service_role / secret key。'
      + ' 前端绝不能打包该密钥，请立即在 Supabase 轮换并改用 anon public key。'
    );
  }

  return {
    // 使用 History 路由：必须用根路径 base，保证 /questions/:id 等嵌套路由
    // 刷新时静态资源仍从 /assets 加载。Cloudflare Pages 部署在域名根路径。
    base: '/',
    plugins: [vue(), UnoCSS()],
    server: { port: 5175, strictPort: true },
    preview: { port: 4175, strictPort: true },
    build: {
      outDir: 'dist',
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1600
    }
  };
});
